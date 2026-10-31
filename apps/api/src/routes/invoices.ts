import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalInteger, optionalText, requiredText } from '../validation.js';

const statuses = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'] as const;
const paymentMethods = ['cash', 'debit_card', 'credit_card', 'check', 'ach', 'other'] as const;
const defaultTaxRate = 8.875;
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
      const invoiceNumber = optionalText(req.body.invoiceNumber, 'invoiceNumber') || await nextInvoiceNumber(tx);
      return tx.invoice.create({ data: { invoiceNumber, customerId: links.customerId, jobId: links.jobId, claimId: links.claimId, ...parseWalkInDetails(req.body), status: req.body.status === undefined ? 'draft' : validate(req.body.status, statuses, 'status'), issueDate: req.body.issueDate ? parseDate(req.body.issueDate, 'issueDate') : new Date(), dueDate: req.body.dueDate ? parseDate(req.body.dueDate, 'dueDate') : undefined, subtotal: totals.subtotal, tax: totals.tax, total: totals.total, amountPaid: 0, balanceDue: totals.total, notes: optionalText(req.body.notes, 'notes'), lineItems: { create: lineItems } }, include: { lineItems: true, payments: true } });
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
    const totals = totalsFor(lineItems, req.body.taxRate);
    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = optionalText(req.body.invoiceNumber, 'invoiceNumber') || await nextInvoiceNumber(tx);
      return tx.invoice.create({ data: { invoiceNumber, customerId: job.customerId, jobId: job.id, claimId: job.claimId, status: 'sent', issueDate: new Date(), subtotal: totals.subtotal, tax: totals.tax, total: totals.total, balanceDue: totals.total, notes: 'Generated from completed job work and expenses', lineItems: { create: lineItems } }, include: { customer: true, job: { select: { id: true, jobNumber: true } }, claim: { select: { id: true, claimNumber: true } }, lineItems: true, payments: true } });
    });
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
      return tx.invoice.update({ where: { id }, data: { customerId: links.customerId, jobId: links.jobId, claimId: links.claimId, ...parseWalkInDetails(req.body), status: req.body.status === undefined ? undefined : validate(req.body.status, statuses, 'status'), issueDate: req.body.issueDate === undefined ? undefined : parseDate(req.body.issueDate, 'issueDate'), dueDate: req.body.dueDate === undefined ? undefined : (req.body.dueDate ? parseDate(req.body.dueDate, 'dueDate') : null), subtotal: totals?.subtotal, tax: totals?.tax, total, balanceDue: Math.max(0, total - amountPaid), notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes'), lineItems: lineItems ? { create: lineItems } : undefined }, include: { lineItems: true, payments: true } });
    });
    res.json(invoice);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = routeParam(req, 'id');
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
    await prisma.invoice.delete({ where: { id } });
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
function parseWalkInDetails(body: Record<string, unknown>) {
  return {
    walkInCustomerName: optionalText(body.walkInCustomerName, 'walkInCustomerName'),
    walkInCustomerAddress: optionalText(body.walkInCustomerAddress, 'walkInCustomerAddress'),
    walkInCustomerPhone: optionalText(body.walkInCustomerPhone, 'walkInCustomerPhone'),
    walkInCustomerEmail: optionalText(body.walkInCustomerEmail, 'walkInCustomerEmail'),
    walkInVehicleYear: optionalInteger(body.walkInVehicleYear, 'walkInVehicleYear'),
    walkInVehicleMake: optionalText(body.walkInVehicleMake, 'walkInVehicleMake'),
    walkInVehicleModel: optionalText(body.walkInVehicleModel, 'walkInVehicleModel'),
    walkInVehicleTrim: optionalText(body.walkInVehicleTrim, 'walkInVehicleTrim'),
    walkInVehicleVin: optionalText(body.walkInVehicleVin, 'walkInVehicleVin')?.toUpperCase(),
    walkInVehicleLicense: optionalText(body.walkInVehicleLicense, 'walkInVehicleLicense')?.toUpperCase(),
    walkInVehicleState: optionalText(body.walkInVehicleState, 'walkInVehicleState')?.toUpperCase(),
  };
}
function totalsFor(items: Array<{ quantity: number; unitPrice: number }>, taxRateValue: unknown) { const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100; const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)); const taxRate = taxRateValue === undefined ? defaultTaxRate : nonNegative(taxRateValue); const tax = roundCurrency(subtotal * taxRate / 100); const total = roundCurrency(subtotal + tax); return { subtotal, tax, total }; }
function routeParam(req: { params: Record<string, string | string[]> }, name: string) { const value = req.params[name]; if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`); return value; }
function parseDate(value: unknown, field: string) { const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new ApiError(400, `${field} must be a valid date`); return result; }
function positive(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new ApiError(400, 'amount must be a positive number'); return result; }
function nonNegative(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new ApiError(400, 'value must be a non-negative number'); return result; }
function validate<T extends readonly string[]>(value: unknown, values: T, field: string) { const result = requiredText(value, field); if (!values.includes(result)) throw new ApiError(400, `${field} is invalid`); return result; }
export async function nextInvoiceNumber(tx: Prisma.TransactionClient) {
  while (true) {
    const [{ number }] = await tx.$queryRaw<Array<{ number: bigint }>>`SELECT nextval('invoice_number_seq') AS number`;
    const invoiceNumber = `INV-${number}`;
    if (!(await tx.invoice.findUnique({ where: { invoiceNumber }, select: { id: true } }))) return invoiceNumber;
  }
}

async function createInvoicePdf(invoice: {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customer: { firstName: string; lastName: string; phone: string | null; email: string | null; address: string | null } | null;
  job: { jobNumber: string; vehicle: { year: number | null; make: string | null; model: string | null; trim: string | null; bodyClass: string | null; vin: string | null; licensePlate: string | null; licenseState: string | null; color: string | null } | null } | null;
  claim: { claimNumber: string | null; customerClaimNumber: string | null; customerName: string | null; customerPhone: string | null; customerAddress: string | null; customerInsurance: string | null; customerPolicyNumber: string | null; vehicleYear: number | null; vehicleMake: string | null; vehicleModel: string | null; vehicleTrim: string | null; vehicleBodyClass: string | null; vehicleVin: string | null; vehicleLicensePlate: string | null; vehiclePlateState: string | null; vehicleColor: string | null; insuranceCompany: string | null; adjusterName: string | null; adjusterPhone: string | null } | null;
  walkInCustomerName: string | null;
  walkInCustomerAddress: string | null;
  walkInCustomerPhone: string | null;
  walkInCustomerEmail: string | null;
  walkInVehicleYear: number | null;
  walkInVehicleMake: string | null;
  walkInVehicleModel: string | null;
  walkInVehicleTrim: string | null;
  walkInVehicleVin: string | null;
  walkInVehicleLicense: string | null;
  walkInVehicleState: string | null;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  payments: Array<{ date: Date; method: string; amount: number; notes: string | null }>;
}) {
  // Mastercraft palette: the shop's orange accent over charcoal and warm greys.
  const orange = '#D36124';
  const charcoal = '#2B2B2B';
  const ink = '#1A1A1A';
  const muted = '#6B6B6B';
  const rule = '#D8D8D8';
  const tint = '#F5F3F1';
  const pageWidth = 612;
  const left = 40;
  const width = 532;
  const right = left + width;
  const contentBottom = 698;
  const footerY = 736;

  const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const date = (value: Date | null) => value ? value.toLocaleDateString('en-US') : '';
  const vehicle = invoice.job?.vehicle;
  const claim = invoice.claim;

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 40, bottom: 40, left, right: 40 },
    bufferPages: true,
    info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: 'Mastercraft Auto Repair & Collision' },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const setText = (size: number, options: { bold?: boolean; color?: string } = {}) => {
    doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(options.color || ink);
  };
  const write = (value: string, x: number, y: number, w: number, options: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center'; height?: number } = {}) => {
    setText(options.size || 9, options);
    doc.text(value, x, y, { width: w, align: options.align || 'left', height: options.height, ellipsis: true, lineBreak: true });
  };
  const caps = (value: string, x: number, y: number, w: number, color = muted) => {
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(color);
    doc.text(value.toUpperCase(), x, y, { width: w, characterSpacing: 0.6, lineBreak: false });
  };

  const drawFirstPageHeader = () => {
    doc.rect(0, 0, pageWidth, 8).fill(orange);
    write('MASTERCRAFT AUTO REPAIR & COLLISION', left, 30, 330, { size: 15, bold: true, color: charcoal });
    write('38-21 23rd Street, Long Island City, NY 11101', left, 51, 330, { size: 8, color: muted });
    write('718-603-0412  |  718-578-4563  |  shop@mastercraftautony.com', left, 62, 330, { size: 8, color: muted });
    write('www.mastercraftautony.com  |  Facility No. 7136099  |  EIN 42-2914045', left, 73, 330, { size: 8, color: muted });

    write('INVOICE', right - 200, 26, 200, { size: 26, bold: true, color: charcoal, align: 'right' });
    const meta: Array<[string, string]> = [
      ['Invoice no.', invoice.invoiceNumber],
      ['Issue date', date(invoice.issueDate)],
      ['Due date', date(invoice.dueDate) || '—'],
    ];
    meta.forEach(([label, value], index) => {
      const y = 60 + index * 12;
      write(label, right - 200, y, 110, { size: 8, color: muted });
      write(value, right - 110, y, 110, { size: 8, bold: true, align: 'right' });
    });
    doc.rect(left, 96, width, 1.6).fill(orange);
  };

  const drawContinuationHeader = (pageNumber: number) => {
    doc.rect(0, 0, pageWidth, 8).fill(orange);
    write('MASTERCRAFT AUTO REPAIR & COLLISION', left, 24, 320, { size: 9, bold: true, color: charcoal });
    write(`Invoice ${invoice.invoiceNumber}  ·  Page ${pageNumber}`, right - 220, 25, 220, { size: 8, color: muted, align: 'right' });
    doc.rect(left, 42, width, 0.8).fill(rule);
  };

  // Titled block of label/value rows. Returns the y position below the block.
  const detailBlock = (title: string, rows: Array<[string, string | number | null | undefined]>, x: number, y: number, w: number) => {
    caps(title, x, y, w, orange);
    doc.rect(x, y + 13, w, 0.8).fill(rule);
    let rowY = y + 19;
    for (const [label, value] of rows) {
      write(label, x, rowY, 74, { size: 7.5, color: muted });
      write(value == null || value === '' ? '' : String(value), x + 76, rowY, w - 76, { size: 8.5, bold: false, height: 11 });
      rowY += 14;
    }
    return rowY;
  };

  drawFirstPageHeader();

  const customerName = invoice.customer ? `${invoice.customer.firstName} ${invoice.customer.lastName}` : invoice.walkInCustomerName || invoice.customerName || claim?.customerName || 'Walk-in / counter sale';
  const vehicleYear = vehicle?.year ?? claim?.vehicleYear ?? invoice.walkInVehicleYear;
  const vehicleMake = vehicle?.make ?? claim?.vehicleMake ?? invoice.walkInVehicleMake;
  const vehicleModel = vehicle?.model ?? claim?.vehicleModel ?? invoice.walkInVehicleModel;
  const vehicleTrim = vehicle?.trim ?? claim?.vehicleTrim ?? invoice.walkInVehicleTrim ?? vehicle?.bodyClass ?? claim?.vehicleBodyClass;
  const plate = [vehicle?.licensePlate ?? claim?.vehicleLicensePlate ?? invoice.walkInVehicleLicense, vehicle?.licenseState ?? claim?.vehiclePlateState ?? invoice.walkInVehicleState].filter(Boolean).join(' / ');
  const insurance = claim?.insuranceCompany || claim?.customerInsurance;

  const cardTop = 110;
  const colWidth = 250;
  const rightCol = left + width - colWidth;
  const billEnd = detailBlock('Bill to', [
    ['Customer', customerName],
    ['Address', invoice.customer?.address || invoice.walkInCustomerAddress || invoice.customerAddress || claim?.customerAddress],
    ['Phone', invoice.customer?.phone || invoice.walkInCustomerPhone || invoice.customerPhone || claim?.customerPhone],
    ['Email', invoice.customer?.email || invoice.walkInCustomerEmail || invoice.customerEmail],
    ['Claim no.', claim?.claimNumber || claim?.customerClaimNumber],
    ['Insurance', insurance],
  ], left, cardTop, colWidth);
  const vehicleEnd = detailBlock('Vehicle', [
    ['Year / make / model', [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ')],
    ['Style / color', [vehicleTrim, vehicle?.color ?? claim?.vehicleColor].filter(Boolean).join(' / ')],
    ['VIN', vehicle?.vin ?? claim?.vehicleVin ?? invoice.walkInVehicleVin],
    ['License plate', plate],
    ['Job / RO no.', invoice.job?.jobNumber],
    ['Adjuster', claim?.adjusterName],
  ], rightCol, cardTop, colWidth);

  // Line items table
  const columns = {
    no: { x: left, w: 28, align: 'left' as const },
    description: { x: left + 28, w: 280, align: 'left' as const },
    qty: { x: left + 308, w: 52, align: 'right' as const },
    unit: { x: left + 360, w: 84, align: 'right' as const },
    amount: { x: left + 444, w: 88, align: 'right' as const },
  };
  let pageNumber = 1;
  const drawTableHeader = (y: number) => {
    doc.rect(left, y, width, 19).fill(charcoal);
    const labels: Array<[keyof typeof columns, string]> = [['no', '#'], ['description', 'Description'], ['qty', 'Qty'], ['unit', 'Unit price'], ['amount', 'Amount']];
    for (const [key, label] of labels) {
      const column = columns[key];
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF');
      doc.text(label.toUpperCase(), column.x + 6, y + 6.5, { width: column.w - 12, align: column.align, characterSpacing: 0.4, lineBreak: false });
    }
    return y + 19;
  };

  let y = Math.max(billEnd, vehicleEnd) + 14;
  y = drawTableHeader(y);
  const items = invoice.lineItems.length ? invoice.lineItems : [];
  if (!items.length) {
    doc.rect(left, y, width, 22).fill(tint);
    write('No line items recorded', left + 8, y + 7, 300, { size: 8.5, color: muted });
    y += 22;
  }
  items.forEach((item, index) => {
    setText(8.5);
    const descriptionHeight = doc.heightOfString(item.description, { width: columns.description.w - 12 });
    const rowHeight = Math.max(20, descriptionHeight + 10);
    if (y + rowHeight > contentBottom) {
      doc.addPage();
      pageNumber += 1;
      drawContinuationHeader(pageNumber);
      y = drawTableHeader(64);
    }
    if (index % 2 === 0) doc.rect(left, y, width, rowHeight).fill(tint);
    write(String(index + 1), columns.no.x + 6, y + 6, columns.no.w - 12, { size: 8, color: muted });
    write(item.description, columns.description.x + 6, y + 6, columns.description.w - 12, { size: 8.5 });
    write(String(item.quantity), columns.qty.x + 6, y + 6, columns.qty.w - 12, { size: 8.5, align: 'right' });
    write(money(item.unitPrice), columns.unit.x + 6, y + 6, columns.unit.w - 12, { size: 8.5, align: 'right' });
    write(money(item.quantity * item.unitPrice), columns.amount.x + 6, y + 6, columns.amount.w - 12, { size: 8.5, bold: true, align: 'right' });
    doc.rect(left, y + rowHeight, width, 0.5).fill(rule);
    y += rowHeight;
  });

  // Summary: notes and payments on the left, totals on the right.
  y += 14;
  const needed = 210;
  if (y + needed > contentBottom) {
    doc.addPage();
    pageNumber += 1;
    drawContinuationHeader(pageNumber);
    y = 64;
  }
  const summaryTop = y;
  const totalsX = left + 300;
  const totalsWidth = width - 300;
  const totalRows: Array<[string, string, boolean?]> = [
    ['Subtotal', money(invoice.subtotal)],
    ['Sales tax', money(invoice.tax)],
    ['Total', money(invoice.total), true],
    ['Amount paid', money(invoice.amountPaid)],
  ];
  let totalY = summaryTop;
  for (const [label, value, bold] of totalRows) {
    write(label, totalsX + 8, totalY + 5, totalsWidth - 100, { size: 8.5, bold: !!bold, color: bold ? charcoal : ink });
    write(value, totalsX + totalsWidth - 100, totalY + 5, 92, { size: 8.5, bold: !!bold, align: 'right' });
    doc.rect(totalsX, totalY + 18, totalsWidth, 0.5).fill(rule);
    totalY += 19;
  }
  doc.rect(totalsX, totalY, totalsWidth, 26).fill(orange);
  write('BALANCE DUE', totalsX + 10, totalY + 9, 120, { size: 8.5, bold: true, color: '#FFFFFF' });
  write(money(invoice.balanceDue), totalsX + totalsWidth - 130, totalY + 7, 120, { size: 12, bold: true, color: '#FFFFFF', align: 'right' });
  totalY += 26;

  let leftY = summaryTop;
  if (invoice.payments.length) {
    caps('Payments received', left, leftY, 260, orange);
    doc.rect(left, leftY + 13, 260, 0.8).fill(rule);
    leftY += 19;
    for (const payment of invoice.payments) {
      write(`${date(payment.date)}  ·  ${payment.method.replace(/_/g, ' ')}${payment.notes ? ` · ${payment.notes}` : ''}`, left, leftY, 180, { size: 8 });
      write(money(payment.amount), left + 180, leftY, 80, { size: 8, bold: true, align: 'right' });
      leftY += 13;
    }
    leftY += 6;
  }
  if (invoice.notes) {
    caps('Notes', left, leftY, 260, orange);
    doc.rect(left, leftY + 13, 260, 0.8).fill(rule);
    leftY += 19;
    write(invoice.notes, left, leftY, 250, { size: 8 });
    leftY += doc.heightOfString(invoice.notes, { width: 250 }) + 6;
  }

  // Completion and authorization
  let authY = Math.max(totalY, leftY) + 22;
  if (authY + 110 > contentBottom) {
    doc.addPage();
    pageNumber += 1;
    drawContinuationHeader(pageNumber);
    authY = 64;
  }
  caps('Completion & authorization', left, authY, width, orange);
  doc.rect(left, authY + 13, width, 0.8).fill(rule);
  write(`Proposed completion date: ${date(invoice.dueDate) || '____________________'}`, left, authY + 22, width, { size: 8.5, bold: true });
  write('The charges above cover parts, labor, refinishing, and other work performed on the vehicle identified on this invoice. Any additional or supplemental work will be documented separately.', left, authY + 38, width, { size: 7.8, color: muted });
  write('I acknowledge that the work listed above was performed and approve the charges shown.', left, authY + 64, width, { size: 7.8, color: ink });
  doc.rect(left, authY + 98, 250, 0.8).fill('#555555');
  doc.rect(left + 282, authY + 98, 250, 0.8).fill('#555555');
  caps('Customer signature', left, authY + 103, 250);
  caps('Date', left + 282, authY + 103, 250);

  // Footer on every page, with page numbers filled in at the end.
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  for (let index = 0; index < pageCount; index += 1) {
    doc.switchToPage(range.start + index);
    doc.rect(left, footerY - 8, width, 0.6).fill(rule);
    write('Thank you for choosing Mastercraft Auto Repair & Collision.', left, footerY, 360, { size: 7.2, color: muted });
    write(`Page ${index + 1} of ${pageCount}`, right - 140, footerY, 140, { size: 7.2, color: muted, align: 'right' });
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