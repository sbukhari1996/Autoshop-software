import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalText, requiredText } from '../validation.js';

const statuses = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'] as const;
const paymentMethods = ['cash', 'debit_card', 'credit_card', 'check', 'ach', 'other'] as const;
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createInvoicesRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    res.json(await prisma.invoice.findMany({ orderBy: { issueDate: 'desc' }, include: { customer: true, job: { select: { id: true, jobNumber: true } }, claim: { select: { id: true, claimNumber: true } }, lineItems: true, payments: true, documents: true } }));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: routeParam(req, 'id') }, include: { customer: true, job: true, claim: true, lineItems: true, payments: { orderBy: { date: 'desc' } }, documents: { orderBy: { createdAt: 'desc' } } } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
    res.json(invoice);
  }));

  router.post('/:id/pdf', asyncHandler(async (req, res) => {
    const id = routeParam(req, 'id');
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { customer: true, job: { include: { vehicle: true } }, claim: true, lineItems: { orderBy: { createdAt: 'asc' } }, payments: { orderBy: { date: 'asc' } } } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');

    const fileName = `invoice-${invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${randomUUID()}.pdf`;
    const absolutePath = path.join(uploadDirectory, fileName);
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(absolutePath, await createInvoicePdf(invoice));
    const pdfFilePath = path.relative(process.cwd(), absolutePath);
    const updated = await prisma.invoice.update({ where: { id }, data: { pdfFileName: fileName, pdfFilePath } });
    res.status(201).json({ invoiceId: updated.id, fileName: updated.pdfFileName, generatedAt: new Date().toISOString(), downloadUrl: `/api/invoices/${updated.id}/pdf/download` });
  }));

  router.get('/:id/pdf/download', asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: routeParam(req, 'id') }, select: { pdfFileName: true, pdfFilePath: true } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
    if (!invoice.pdfFileName || !invoice.pdfFilePath) throw new ApiError(404, 'Invoice PDF has not been generated');
    const resolvedPath = path.resolve(process.cwd(), invoice.pdfFilePath);
    const relativePath = path.relative(uploadDirectory, resolvedPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new ApiError(400, 'Stored file path is invalid');
    try {
      await stat(resolvedPath);
      res.type('application/pdf').set('Content-Disposition', `attachment; filename="${invoice.pdfFileName}"`).send(await readFile(resolvedPath));
    } catch {
      throw new ApiError(404, 'Stored file not found');
    }
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const links = await validateLinks(prisma, req.body.customerId, req.body.jobId, req.body.claimId);
    const lineItems = parseLineItems(req.body.lineItems);
    const invoice = await prisma.$transaction(async (tx) => {
      const totals = totalsFor(lineItems, req.body.taxRate);
      return tx.invoice.create({ data: { invoiceNumber: optionalText(req.body.invoiceNumber, 'invoiceNumber') || `INV-${Date.now()}-${randomUUID().slice(0, 8)}`, customerId: links.customerId, customerName: links.customerId ? null : optionalText(req.body.customerName, 'customerName'), customerPhone: links.customerId ? null : optionalText(req.body.customerPhone, 'customerPhone'), customerEmail: links.customerId ? null : optionalText(req.body.customerEmail, 'customerEmail'), customerAddress: links.customerId ? null : optionalText(req.body.customerAddress, 'customerAddress'), jobId: links.jobId, claimId: links.claimId, status: req.body.status === undefined ? 'draft' : validate(req.body.status, statuses, 'status'), issueDate: req.body.issueDate ? parseDate(req.body.issueDate, 'issueDate') : new Date(), dueDate: req.body.dueDate ? parseDate(req.body.dueDate, 'dueDate') : undefined, subtotal: totals.subtotal, tax: totals.tax, total: totals.total, amountPaid: 0, balanceDue: totals.total, notes: optionalText(req.body.notes, 'notes'), lineItems: { create: lineItems } }, include: { lineItems: true, payments: true } });
    });
    res.status(201).json(invoice);
  }));

  router.post('/from-job/:jobId', asyncHandler(async (req, res) => {
    const jobId = routeParam(req, 'jobId');
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { customer: true, vehicle: true, claim: true, estimates: { orderBy: { updatedAt: 'desc' }, take: 1, include: { lineItems: true } }, expenses: { orderBy: { expenseDate: 'asc' } } } });
    if (!job) throw new ApiError(404, 'Job not found');
    const estimate = job.estimates[0];
    const estimateParts = estimate?.lineItems.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) || 0;
    const lineItems = [
      ...(estimate?.lineItems.length ? estimate.lineItems.map((line) => ({ description: [line.section, line.operation, line.description].filter(Boolean).join(' · '), quantity: line.quantity, unitPrice: line.unitPrice })) : estimate ? [{ description: `Repair work per estimate ${estimate.estimateNumber || 'record'}`, quantity: 1, unitPrice: estimate.totalAmount }] : []),
      ...(estimate && estimate.totalAmount > estimateParts ? [{ description: `Labor, paint and supplies per estimate ${estimate.estimateNumber || 'record'}`, quantity: 1, unitPrice: estimate.totalAmount - estimateParts }] : []),
      ...job.expenses.map((expense) => ({ description: expense.category ? `${expense.category}: ${expense.description}` : expense.description, quantity: 1, unitPrice: expense.amount })),
    ];
    if (!lineItems.length) throw new ApiError(400, 'Job has no estimate or expenses to invoice');
    const totals = totalsFor(lineItems, 0);
    const invoice = await prisma.invoice.create({ data: { invoiceNumber: optionalText(req.body.invoiceNumber, 'invoiceNumber') || `INV-${job.jobNumber}-${Date.now()}`, customerId: job.customerId, jobId: job.id, claimId: job.claimId, status: 'sent', issueDate: new Date(), subtotal: totals.subtotal, tax: totals.tax, total: totals.total, balanceDue: totals.total, notes: 'Generated from completed job work and expenses', lineItems: { create: lineItems } }, include: { customer: true, job: { select: { id: true, jobNumber: true } }, claim: { select: { id: true, claimNumber: true } }, lineItems: true, payments: true } });
    res.status(201).json(invoice);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const id = routeParam(req, 'id');
    const existing = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!existing) throw new ApiError(404, 'Invoice not found');
    const links = await validateLinks(prisma, req.body.customerId === undefined ? existing.customerId : req.body.customerId, req.body.jobId === undefined ? existing.jobId : req.body.jobId, req.body.claimId === undefined ? existing.claimId : req.body.claimId);
    const lineItems = req.body.lineItems === undefined ? undefined : parseLineItems(req.body.lineItems);
    const invoice = await prisma.$transaction(async (tx) => {
      const totals = lineItems ? totalsFor(lineItems, req.body.taxRate) : undefined;
      if (lineItems) await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      const amountPaid = existing.amountPaid;
      const total = totals?.total ?? existing.total;
      return tx.invoice.update({ where: { id }, data: { customerId: links.customerId, customerName: links.customerId ? null : req.body.customerName === undefined ? undefined : optionalText(req.body.customerName, 'customerName'), customerPhone: links.customerId ? null : req.body.customerPhone === undefined ? undefined : optionalText(req.body.customerPhone, 'customerPhone'), customerEmail: links.customerId ? null : req.body.customerEmail === undefined ? undefined : optionalText(req.body.customerEmail, 'customerEmail'), customerAddress: links.customerId ? null : req.body.customerAddress === undefined ? undefined : optionalText(req.body.customerAddress, 'customerAddress'), jobId: links.jobId, claimId: links.claimId, status: req.body.status === undefined ? undefined : validate(req.body.status, statuses, 'status'), issueDate: req.body.issueDate === undefined ? undefined : parseDate(req.body.issueDate, 'issueDate'), dueDate: req.body.dueDate === undefined ? undefined : (req.body.dueDate ? parseDate(req.body.dueDate, 'dueDate') : null), subtotal: totals?.subtotal, tax: totals?.tax, total, balanceDue: Math.max(0, total - amountPaid), notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes'), lineItems: lineItems ? { create: lineItems } : undefined }, include: { lineItems: true, payments: true } });
    });
    res.json(invoice);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = routeParam(req, 'id');
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
    await prisma.$transaction(async (tx) => {
      await tx.financeEntry.deleteMany({ where: { sourceReference: { in: invoice.payments.map((payment) => `invoice-payment:${payment.id}`) } } });
      await tx.invoice.delete({ where: { id } });
    });
    res.status(204).send();
  }));

  router.get('/:id/payments', asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: routeParam(req, 'id') }, select: { id: true } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
    res.json(await prisma.payment.findMany({ where: { invoiceId: invoice.id }, orderBy: { date: 'desc' } }));
  }));

  router.post('/:id/payments', asyncHandler(async (req, res) => {
    const invoiceId = routeParam(req, 'id');
    const payment = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
      if (!invoice) throw new ApiError(404, 'Invoice not found');
      const amount = positive(req.body.amount);
      const paid = invoice.payments.reduce((sum, item) => sum + item.amount, 0);
      if (paid + amount > invoice.total + 0.005) throw new ApiError(400, 'Payment exceeds invoice balance');
      const created = await tx.payment.create({ data: { invoiceId, method: validate(req.body.method, paymentMethods, 'method'), amount, date: req.body.date ? parseDate(req.body.date, 'date') : new Date(), notes: optionalText(req.body.notes, 'notes') } });
      const amountPaid = paid + amount;
      await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid, balanceDue: Math.max(0, invoice.total - amountPaid), status: amountPaid >= invoice.total ? 'paid' : 'partial' } });
      await tx.financeEntry.upsert({ where: { sourceReference: `invoice-payment:${created.id}` }, create: { sourceReference: `invoice-payment:${created.id}`, type: 'income', description: `Payment for invoice ${invoice.invoiceNumber}`, amount, paymentMethod: created.method, entryDate: created.date, jobId: invoice.jobId, claimId: invoice.claimId, notes: created.notes }, update: { amount, paymentMethod: created.method, entryDate: created.date, notes: created.notes, jobId: invoice.jobId, claimId: invoice.claimId } });
      return created;
    });
    res.status(201).json(payment);
  }));

  router.get('/:id/documents', asyncHandler(async (req, res) => {
    const invoiceId = routeParam(req, 'id');
    if (!(await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } }))) throw new ApiError(404, 'Invoice not found');
    res.json(await prisma.invoiceDocument.findMany({ where: { invoiceId }, orderBy: { createdAt: 'desc' } }));
  }));

  router.post('/:id/documents', upload.array('file', 10), asyncHandler(async (req, res) => {
    const invoiceId = routeParam(req, 'id');
    if (!(await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } }))) throw new ApiError(404, 'Invoice not found');
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!files.length || files.some((file) => file.size === 0)) throw new ApiError(400, 'at least one non-empty file is required');
    const documentType = optionalText(req.body.documentType, 'documentType') || 'receipt';
    const description = optionalText(req.body.description, 'description');
    await mkdir(uploadDirectory, { recursive: true });
    const documents = [];
    for (const file of files) {
      const originalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'receipt';
      const storedName = `${randomUUID()}-${originalName}`;
      await writeFile(path.join(uploadDirectory, storedName), file.buffer, { flag: 'wx' });
      const filePath = path.relative(process.cwd(), path.join(uploadDirectory, storedName));
      const document = await prisma.invoiceDocument.create({ data: { invoiceId, fileName: originalName, filePath, documentType, description } });
      documents.push({ ...document, downloadUrl: `/api/invoices/${invoiceId}/documents/${document.id}/download` });
    }
    res.status(201).json({ documents });
  }));

  router.get('/:id/documents/:documentId/download', asyncHandler(async (req, res) => {
    const invoiceId = routeParam(req, 'id');
    const documentId = routeParam(req, 'documentId');
    const document = await prisma.invoiceDocument.findFirst({ where: { id: documentId, invoiceId } });
    if (!document) throw new ApiError(404, 'Receipt not found');
    const resolvedPath = path.resolve(process.cwd(), document.filePath);
    const relativePath = path.relative(uploadDirectory, resolvedPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new ApiError(400, 'Stored file path is invalid');
    try {
      await stat(resolvedPath);
      res.type(path.extname(document.fileName) || 'application/octet-stream').set('Content-Disposition', `attachment; filename="${document.fileName}"`).send(await readFile(resolvedPath));
    } catch {
      throw new ApiError(404, 'Stored file not found');
    }
  }));

  router.delete('/:id/documents/:documentId', asyncHandler(async (req, res) => {
    const invoiceId = routeParam(req, 'id');
    const documentId = routeParam(req, 'documentId');
    const document = await prisma.invoiceDocument.findFirst({ where: { id: documentId, invoiceId } });
    if (!document) throw new ApiError(404, 'Receipt not found');
    await prisma.invoiceDocument.delete({ where: { id: documentId } });
    const resolvedPath = path.resolve(process.cwd(), document.filePath);
    const relativePath = path.relative(uploadDirectory, resolvedPath);
    if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) await unlink(resolvedPath).catch(() => {});
    res.status(204).send();
  }));

  return router;
}

async function validateLinks(prisma: PrismaClient, customerIdValue: unknown, jobIdValue: unknown, claimIdValue: unknown) {
  const customerId = optionalText(customerIdValue, 'customerId') || null;
  const jobId = optionalText(jobIdValue, 'jobId') || null;
  const claimId = optionalText(claimIdValue, 'claimId') || null;
  if (!customerId && (jobId || claimId)) throw new ApiError(400, 'A customer is required to link an invoice to a job or claim');
  const [customer, job, claim] = await Promise.all([customerId ? prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }) : null, jobId ? prisma.job.findUnique({ where: { id: jobId }, select: { id: true, customerId: true, claimId: true } }) : null, claimId ? prisma.claim.findUnique({ where: { id: claimId }, select: { id: true, customerId: true } }) : null]);
  if (customerId && !customer) throw new ApiError(404, 'Customer not found');
  if (jobId && (!job || job.customerId !== customerId)) throw new ApiError(400, 'Job must belong to the customer');
  if (claimId && (!claim || claim.customerId !== customerId)) throw new ApiError(400, 'Claim must belong to the customer');
  if (jobId && claimId && job?.claimId !== claimId) throw new ApiError(400, 'Claim must belong to the job');
  return { customerId, jobId, claimId };
}

function parseLineItems(value: unknown) { if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'lineItems must contain at least one item'); return value.map((item, index) => ({ description: requiredText(item?.description, `lineItems[${index}].description`), quantity: positive(item?.quantity ?? 1), unitPrice: nonNegative(item?.unitPrice) })); }
function totalsFor(items: Array<{ quantity: number; unitPrice: number }>, taxRateValue: unknown) { const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0); const taxRate = taxRateValue === undefined ? 0 : nonNegative(taxRateValue); const tax = subtotal * taxRate / 100; return { subtotal, tax, total: subtotal + tax }; }
function routeParam(req: { params: Record<string, string | string[]> }, name: string) { const value = req.params[name]; if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`); return value; }
function parseDate(value: unknown, field: string) { const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new ApiError(400, `${field} must be a valid date`); return result; }
function positive(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new ApiError(400, 'amount must be a positive number'); return result; }
function nonNegative(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new ApiError(400, 'value must be a non-negative number'); return result; }
function validate<T extends readonly string[]>(value: unknown, values: T, field: string) { const result = requiredText(value, field); if (!values.includes(result)) throw new ApiError(400, `${field} is invalid`); return result; }

async function createInvoicePdf(invoice: {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customer: { firstName: string; lastName: string; phone: string | null; email: string | null; address: string | null } | null;
  job: { jobNumber: string; vehicle: { year: number | null; make: string | null; model: string | null; trim: string | null; bodyClass: string | null; vin: string | null; licensePlate: string | null; licenseState: string | null; color: string | null } | null } | null;
  claim: { claimNumber: string | null; customerClaimNumber: string | null; customerName: string | null; customerPhone: string | null; customerAddress: string | null; customerInsurance: string | null; customerPolicyNumber: string | null; vehicleYear: number | null; vehicleMake: string | null; vehicleModel: string | null; vehicleTrim: string | null; vehicleBodyClass: string | null; vehicleVin: string | null; vehicleLicensePlate: string | null; vehiclePlateState: string | null; vehicleColor: string | null; insuranceCompany: string | null; adjusterName: string | null; adjusterPhone: string | null } | null;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  payments: Array<{ date: Date; method: string; amount: number; notes: string | null }>;
}) {
  const money = (amount: number) => `$${amount.toFixed(2)}`;
  const date = (value: Date | null) => value ? value.toLocaleDateString('en-US') : '';
  const vehicle = invoice.job?.vehicle;
  const claim = invoice.claim;
  const doc = new PDFDocument({ size: 'LETTER', margin: 28, bufferPages: true });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const left = 36;
  const pageWidth = 540;
  const right = left + pageWidth;
  const text = (value: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => {
    doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 8).fillColor(options.color || '#171717').text(value, x, y, { width: options.width, align: options.align || 'left', lineBreak: false });
  };
  const fit = (value: string | number | null | undefined, width: number, size = 7) => {
    let result = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
    doc.font('Helvetica').fontSize(size);
    while (result && doc.widthOfString(result) > width) result = `${result.slice(0, -1).trimEnd()}`;
    if (result !== String(value ?? '').replace(/\s+/g, ' ').trim() && width > 18) {
      while (result && doc.widthOfString(`${result}...`) > width) result = result.slice(0, -1).trimEnd();
      result = result ? `${result}...` : '';
    }
    return result;
  };
  const field = (label: string, value: string | number | null | undefined, x: number, y: number, width: number, height: number) => {
    text(label.toUpperCase(), x + 4, y + 3, { size: 5.3, bold: true, color: '#555555', width: width - 8 });
    text(fit(value, width - 8, 7), x + 4, y + 12, { size: 7, width: width - 8 });
    doc.rect(x, y, width, height).lineWidth(0.35).stroke('#9b9b9b');
  };
  const drawFormHeader = () => {
    doc.rect(left, 25, 4, 55).fill('#d36124');
    text('MASTERCRAFT AUTO REPAIR & COLLISION', left + 12, 27, { size: 13, bold: true, width: 330 });
    text('38-21 23rd Street, Long Island City, NY 11101', left + 12, 45, { size: 7.5 });
    text('718-603-0412  |  718-578-4563  |  shop@mastercraftautony.com', left + 12, 57, { size: 7.2 });
    text('www.mastercraftautony.com  |  Facility No. 7136099  |  EIN 42-2914045', left + 12, 69, { size: 7 });
    text('INVOICE', 404, 30, { size: 20, bold: true, width: 172, align: 'right' });
    text(`Invoice No. ${fit(invoice.invoiceNumber, 135, 8)}`, 404, 56, { size: 8, bold: true, width: 172, align: 'right' });
    text(`Date: ${date(invoice.issueDate)}`, 404, 69, { size: 7.5, width: 172, align: 'right' });

    doc.rect(left, 89, pageWidth, 21).fill('#333333');
    text('VEHICLE REPAIR INVOICE', left + 8, 96, { size: 10, bold: true, color: '#ffffff', width: pageWidth - 16 });
    text(`INVOICE NO. ${invoice.invoiceNumber}`, left + 300, 96, { size: 8, bold: true, color: '#ffffff', width: 232, align: 'right' });

    const boxY = 115;
    const boxHeight = 78;
    const half = pageWidth / 2;
    const rowHeight = boxHeight / 4;
    const customerName = invoice.customer ? `${invoice.customer.firstName} ${invoice.customer.lastName}` : invoice.customerName || claim?.customerName || 'Walk-in / counter sale';
    field('Customer / insured', customerName, left, boxY, half, rowHeight);
    field('Claim number', claim?.claimNumber || claim?.customerClaimNumber, left + half, boxY, half, rowHeight);
    field('Address', invoice.customer?.address || invoice.customerAddress || claim?.customerAddress, left, boxY + rowHeight, half, rowHeight);
    field('Phone', invoice.customer?.phone || invoice.customerPhone || claim?.customerPhone, left + half, boxY + rowHeight, half, rowHeight);
    field('Email', invoice.customer?.email || invoice.customerEmail, left, boxY + rowHeight * 2, half, rowHeight);
    field('Job / repair order', invoice.job?.jobNumber, left + half, boxY + rowHeight * 2, half, rowHeight);
    const vehicleYear = vehicle?.year ?? claim?.vehicleYear;
    const vehicleMake = vehicle?.make ?? claim?.vehicleMake;
    const vehicleModel = vehicle?.model ?? claim?.vehicleModel;
    const vehicleTrim = vehicle?.trim ?? claim?.vehicleTrim ?? vehicle?.bodyClass ?? claim?.vehicleBodyClass;
    field('Year / make / model', [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' '), left, boxY + rowHeight * 3, half, rowHeight);
    field('Style / color', [vehicleTrim, vehicle?.color ?? claim?.vehicleColor].filter(Boolean).join(' / '), left + half, boxY + rowHeight * 3, half, rowHeight);

    const detailsY = boxY + boxHeight + 3;
    const detailHeight = 20;
    const widths = [145, 115, 140, 140];
    const insurance = claim?.insuranceCompany || claim?.customerInsurance;
    const policy = claim?.customerPolicyNumber;
    const plate = [vehicle?.licensePlate ?? claim?.vehicleLicensePlate, vehicle?.licenseState ?? claim?.vehiclePlateState].filter(Boolean).join(' / ');
    field('VIN', vehicle?.vin ?? claim?.vehicleVin, left, detailsY, widths[0], detailHeight);
    field('License plate', plate, left + widths[0], detailsY, widths[1], detailHeight);
    field('Insurance company', insurance, left + widths[0] + widths[1], detailsY, widths[2], detailHeight);
    field('Insurance / policy no.', policy, left + widths[0] + widths[1] + widths[2], detailsY, widths[3], detailHeight);
    field('Adjuster', claim?.adjusterName, left, detailsY + detailHeight, 180, detailHeight);
    field('Adjuster phone', claim?.adjusterPhone, left + 180, detailsY + detailHeight, 150, detailHeight);
    field('Odometer', '', left + 330, detailsY + detailHeight, 100, detailHeight);
    field('Estimate prepared by', '', left + 430, detailsY + detailHeight, 110, detailHeight);
  };
  const drawItemsTable = (items: typeof invoice.lineItems, startIndex: number, pageNumber: number, pageCount: number, includeSummary: boolean) => {
    const columns = [left, left + 22, left + 60, left + 102, left + 270, left + 318, left + 363, left + 415, left + 460, right];
    let y = 278;
    const headerHeight = 19;
    const rowHeight = 17;
    doc.rect(left, y, pageWidth, headerHeight).fill('#dedede');
    const headings = ['No.', 'Repair', 'Replace', 'Description', 'Parts', 'Labor', 'Refinish', 'Sublet', 'Amount'];
    headings.forEach((heading, index) => text(heading, columns[index] + 2, y + 6, { size: 5.8, bold: true, width: columns[index + 1] - columns[index] - 4, align: index > 3 ? 'right' : 'left' }));
    y += headerHeight;
    for (const [index, item] of items.entries()) {
      if (index % 2 === 0) doc.rect(left, y, pageWidth, rowHeight).fill('#f4f4f4');
      text(String(startIndex + index + 1), columns[0] + 2, y + 5, { size: 6.5, width: columns[1] - columns[0] - 4 });
      for (const columnIndex of [1, 2]) {
        const boxWidth = 6;
        const boxX = columns[columnIndex] + (columns[columnIndex + 1] - columns[columnIndex] - boxWidth) / 2;
        doc.rect(boxX, y + 5, boxWidth, boxWidth).lineWidth(0.4).stroke('#777777');
      }
      const description = `${item.quantity !== 1 ? `${item.quantity} x ` : ''}${item.description}`;
      text(fit(description, columns[4] - columns[3] - 7, 6.4), columns[3] + 3, y + 5, { size: 6.4, width: columns[4] - columns[3] - 7 });
      text(money(item.quantity * item.unitPrice), columns[8] + 2, y + 5, { size: 6.5, width: columns[9] - columns[8] - 5, align: 'right' });
      doc.rect(left, y, pageWidth, rowHeight).lineWidth(0.3).stroke('#c2c2c2');
      y += rowHeight;
    }
    if (!items.length) {
      text('No line items recorded', left + 6, y + 5, { size: 7, color: '#555555' });
      doc.rect(left, y, pageWidth, rowHeight).lineWidth(0.3).stroke('#c2c2c2');
      y += rowHeight;
    }
    if (includeSummary) {
      y = 590;
      const leftWidth = 324;
      text(`PROPOSED COMPLETION DATE: ${date(invoice.dueDate) || '________________'}`, left + 2, y + 2, { size: 7, bold: true });
      text('The charges above are for parts, labor, refinishing, and other work performed on the vehicle identified on this invoice.', left + 2, y + 16, { size: 6.5, width: leftWidth });
      text('Please review the listed work and charges. Any additional or supplemental work will be documented separately.', left + 2, y + 34, { size: 6.5, width: leftWidth });
      text('I acknowledge that the work listed above was performed and approve the charges shown.', left + 2, y + 56, { size: 6.3, width: leftWidth });
      doc.moveTo(left + 2, y + 87).lineTo(left + 211, y + 87).stroke('#555555');
      doc.moveTo(left + 231, y + 87).lineTo(left + leftWidth, y + 87).stroke('#555555');
      text('Customer signature', left + 2, y + 90, { size: 5.8, color: '#555555' });
      text('Date', left + 231, y + 90, { size: 5.8, color: '#555555' });

      const totalsX = left + leftWidth + 8;
      const totalsWidth = pageWidth - leftWidth - 8;
      const summaryRows: Array<[string, number | null, boolean?]> = [
        ['Paint hours @', null],
        ['Labor hours @', null],
        ['Parts', null],
        ['Paint / materials', null],
        ['Sublet items', null],
        ['Towing / storage', null],
        ['Subtotal', invoice.subtotal],
        ['Sales tax', invoice.tax],
        ['Total', invoice.total, true],
        ['Amount paid', invoice.amountPaid],
        ['Balance due', invoice.balanceDue, true],
      ];
      let totalY = y - 1;
      const totalRowHeight = 11;
      summaryRows.forEach(([label, amount, bold]) => {
        if (bold) doc.rect(totalsX, totalY, totalsWidth, totalRowHeight).fill('#e9e9e9');
        text(label, totalsX + 3, totalY + 2, { size: 6, bold: !!bold, width: totalsWidth - 63 });
        text(amount == null ? '' : money(amount), totalsX + totalsWidth - 59, totalY + 2, { size: 6.2, bold: !!bold, width: 56, align: 'right' });
        doc.rect(totalsX, totalY, totalsWidth, totalRowHeight).lineWidth(0.3).stroke('#aaaaaa');
        totalY += totalRowHeight;
      });
      if (invoice.payments.length) {
        const paymentSummary = invoice.payments.map((payment) => `${date(payment.date)} ${payment.method.replace('_', ' ')} ${money(payment.amount)}`).join('  |  ');
        text(fit(`Payments: ${paymentSummary}`, pageWidth, 6), left, 716, { size: 6, color: '#555555', width: pageWidth, align: 'center' });
      }
    }
    text(`Page ${pageNumber} of ${pageCount}`, left, 742, { size: 6, color: '#666666', width: pageWidth, align: 'center' });
  };

  const itemsPerPage = 17;
  const pages = Math.max(1, Math.ceil(invoice.lineItems.length / itemsPerPage));
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    if (pageIndex > 0) doc.addPage();
    drawFormHeader();
    const startIndex = pageIndex * itemsPerPage;
    drawItemsTable(invoice.lineItems.slice(startIndex, startIndex + itemsPerPage), startIndex, pageIndex + 1, pages, pageIndex === pages - 1);
  }
  doc.end();
  return result;
}

function pdfEscape(value: string) { return value.replace(/[\\()\r\n]/g, (character) => character === '\\' ? '\\\\' : character === '(' ? '\\(' : character === ')' ? '\\)' : ' '); }
function createPdf(lines: string[]) {
  const pageLines = 32;
  const pages = Array.from({ length: Math.ceil(lines.length / pageLines) }, (_, index) => lines.slice(index * pageLines, (index + 1) * pageLines));
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const pageObjectNumbers: number[] = [];
  const fontObjectNumber = pages.length * 2 + 3;
  pages.forEach((page, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);
    const content = `BT /F1 ${index === 0 ? 16 : 11} Tf 72 740 Td ${page.map((line, lineIndex) => `(${pdfEscape(line)}) Tj${lineIndex === 0 ? '' : ' 0 -20 Td'}`).join(' ')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}