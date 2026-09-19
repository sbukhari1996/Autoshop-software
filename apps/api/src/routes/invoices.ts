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
      return tx.invoice.create({ data: { invoiceNumber: optionalText(req.body.invoiceNumber, 'invoiceNumber') || `INV-${Date.now()}-${randomUUID().slice(0, 8)}`, customerId: links.customerId, jobId: links.jobId, claimId: links.claimId, status: req.body.status === undefined ? 'draft' : validate(req.body.status, statuses, 'status'), issueDate: req.body.issueDate ? parseDate(req.body.issueDate, 'issueDate') : new Date(), dueDate: req.body.dueDate ? parseDate(req.body.dueDate, 'dueDate') : undefined, subtotal: totals.subtotal, tax: totals.tax, total: totals.total, amountPaid: 0, balanceDue: totals.total, notes: optionalText(req.body.notes, 'notes'), lineItems: { create: lineItems } }, include: { lineItems: true, payments: true } });
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
    const links = await validateLinks(prisma, req.body.customerId ?? existing.customerId, req.body.jobId === undefined ? existing.jobId : req.body.jobId, req.body.claimId === undefined ? existing.claimId : req.body.claimId);
    const lineItems = req.body.lineItems === undefined ? undefined : parseLineItems(req.body.lineItems);
    const invoice = await prisma.$transaction(async (tx) => {
      const totals = lineItems ? totalsFor(lineItems, req.body.taxRate) : undefined;
      if (lineItems) await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      const amountPaid = existing.amountPaid;
      const total = totals?.total ?? existing.total;
      return tx.invoice.update({ where: { id }, data: { customerId: links.customerId, jobId: links.jobId, claimId: links.claimId, status: req.body.status === undefined ? undefined : validate(req.body.status, statuses, 'status'), issueDate: req.body.issueDate === undefined ? undefined : parseDate(req.body.issueDate, 'issueDate'), dueDate: req.body.dueDate === undefined ? undefined : (req.body.dueDate ? parseDate(req.body.dueDate, 'dueDate') : null), subtotal: totals?.subtotal, tax: totals?.tax, total, balanceDue: Math.max(0, total - amountPaid), notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes'), lineItems: lineItems ? { create: lineItems } : undefined }, include: { lineItems: true, payments: true } });
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
  const customerId = requiredText(customerIdValue, 'customerId');
  const jobId = optionalText(jobIdValue, 'jobId');
  const claimId = optionalText(claimIdValue, 'claimId');
  const [customer, job, claim] = await Promise.all([prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }), jobId ? prisma.job.findUnique({ where: { id: jobId }, select: { id: true, customerId: true, claimId: true } }) : null, claimId ? prisma.claim.findUnique({ where: { id: claimId }, select: { id: true, customerId: true } }) : null]);
  if (!customer) throw new ApiError(404, 'Customer not found');
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
  customer: { firstName: string; lastName: string; phone: string | null; email: string | null; address: string | null };
  job: { jobNumber: string; vehicle: { year: number | null; make: string | null; model: string | null; trim: string | null; vin: string | null; licensePlate: string | null; licenseState: string | null } | null } | null;
  claim: { claimNumber: string | null } | null;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  payments: Array<{ date: Date; method: string; amount: number; notes: string | null }>;
}) {
  const money = (amount: number) => `$${amount.toFixed(2)}`;
  const date = (value: Date | null) => value ? value.toLocaleDateString('en-US') : 'N/A';
  const vehicle = invoice.job?.vehicle;
  const doc = new PDFDocument({ size: 'LETTER', margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve) => { doc.on('data', (chunk: Buffer) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const pageWidth = 540;
  const right = 576;
  const text = (value: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => { doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 9).fillColor(options.color || '#171717').text(value, x, y, { width: options.width, align: options.align || 'left' }); };
  doc.rect(36, 36, pageWidth, 76).fill('#292929');
  text('MASTERCRAFT AUTO REPAIR & COLLISION', 50, 51, { size: 17, bold: true, color: '#ffffff' });
  text('38-21 23rd Street, Long Island City, NY 11101', 50, 76, { size: 8.5, color: '#eeeeee' });
  text('Tel: 718-578-4563 | 718-603-0412 | shop@mastercraftautony.com', 50, 90, { size: 8.5, color: '#eeeeee' });
  text('www.mastercraftautony.com | Recognized By All Insurance Companies', 50, 104, { size: 8, color: '#f1c232' });
  doc.rect(36, 126, pageWidth, 34).fill('#c90000'); text('INVOICE / ESTIMATE OF RECORD', 36, 136, { size: 15, bold: true, color: '#ffffff', width: pageWidth, align: 'center' });
  doc.rect(36, 174, pageWidth, 25).lineWidth(0.6).stroke('#bdbdbd'); text(`Invoice No: ${invoice.invoiceNumber}`, 45, 182, { size: 8.5, bold: true }); text(`Invoice Date: ${date(invoice.issueDate)}`, 350, 182, { size: 8.5, bold: true, width: 215, align: 'right' });
  doc.rect(36, 216, pageWidth, 78).lineWidth(0.6).stroke('#bdbdbd'); doc.moveTo(306, 216).lineTo(306, 294).stroke('#bdbdbd');
  text('CUSTOMER', 45, 226, { size: 10, bold: true }); text(`${invoice.customer.firstName} ${invoice.customer.lastName}`, 45, 243, { size: 10 }); text(`Address: ${invoice.customer.address || 'N/A'}`, 45, 260, { size: 8.5 }); text(`Phone: ${invoice.customer.phone || 'N/A'}    Email: ${invoice.customer.email || 'N/A'}`, 45, 275, { size: 8.5 });
  text('VEHICLE / JOB', 315, 226, { size: 10, bold: true }); text(vehicle ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') : 'Not specified', 315, 243, { size: 9 }); text(`VIN: ${vehicle?.vin || 'N/A'}`, 315, 260, { size: 8.5 }); text(`License: ${vehicle?.licensePlate || 'N/A'}${vehicle?.licenseState ? ` (${vehicle.licenseState})` : ''}`, 315, 275, { size: 8.5 }); text(`Job: ${invoice.job?.jobNumber || 'N/A'}   Claim: ${invoice.claim?.claimNumber || 'N/A'}`, 315, 287, { size: 7.5 });
  text('REPAIR WORK AND JOB EXPENSES', 36, 316, { size: 10, bold: true, color: '#ffffff', width: pageWidth }); doc.rect(36, 312, pageWidth, 20).fill('#292929'); text('REPAIR WORK AND JOB EXPENSES', 45, 318, { size: 10, bold: true, color: '#ffffff' });
  const columns = [36, 345, 400, 476, 576]; let y = 332; doc.rect(36, y, pageWidth, 22).fill('#c90000'); ['Description', 'Qty', 'Unit Price', 'Amount'].forEach((label, index) => text(label, columns[index] + 5, y + 7, { size: 8, bold: true, color: '#ffffff', width: columns[index + 1] - columns[index] - 10, align: index ? 'right' : 'left' })); y += 22;
  for (const [index, item] of invoice.lineItems.entries()) { if (y > 690) { doc.addPage(); y = 45; } if (index % 2 === 0) doc.rect(36, y, pageWidth, 24).fill('#eeeeee'); const description = item.description.length > 58 ? `${item.description.slice(0, 55)}...` : item.description; text(description, 42, y + 7, { size: 8, width: 298 }); text(String(item.quantity), 350, y + 7, { size: 8, width: 45, align: 'right' }); text(money(item.unitPrice), 405, y + 7, { size: 8, width: 66, align: 'right' }); text(money(item.quantity * item.unitPrice), 481, y + 7, { size: 8, width: 88, align: 'right' }); doc.rect(36, y, pageWidth, 24).lineWidth(0.3).stroke('#cccccc'); y += 24; }
  y += 10; const totalsX = 350; const totalLine = (label: string, amount: number, bold = false, size = 9) => { text(label, totalsX, y, { size, bold, width: 135, align: 'right' }); text(money(amount), 490, y, { size, bold, width: 86, align: 'right' }); y += bold ? 24 : 18; };
  totalLine('SUBTOTAL', invoice.subtotal, true); totalLine('SALES TAX', invoice.tax); totalLine('TOTAL COST OF REPAIRS', invoice.total, true, 11); totalLine('AMOUNT PAID', invoice.amountPaid); totalLine('BALANCE DUE', invoice.balanceDue, true, 11);
  y += 8; doc.moveTo(36, y).lineTo(right, y).stroke('#222222'); y += 12; text('PAYMENTS', 36, y, { size: 10, bold: true }); y += 17; if (invoice.payments.length) for (const payment of invoice.payments) { text(`${date(payment.date)}  ${payment.method.replace('_', ' ')}`, 45, y, { size: 8 }); text(money(payment.amount), 490, y, { size: 8, width: 86, align: 'right' }); y += 15; } else { text('No payments recorded', 45, y, { size: 8, color: '#555555' }); y += 15; }
  y += 14; text('This is an invoice for work and expenses recorded for the repair job. Final charges may vary based on supplemental findings.', 36, y, { size: 8, color: '#555555', width: pageWidth }); y += 38; text('Customer Signature: ______________________________', 36, y, { size: 8.5 }); text('Date: ______________', 395, y, { size: 8.5 }); y += 24; text('Shop Authorized By: ______________________________', 36, y, { size: 8.5 }); text('Date: ______________', 395, y, { size: 8.5 }); y += 30; doc.moveTo(36, y).lineTo(right, y).stroke('#222222'); y += 10; text('MASTERCRAFT AUTO REPAIR & COLLISION  •  38-21 23rd Street, Long Island City, NY 11101  •  718-578-4563  •  www.mastercraftautony.com', 36, y, { size: 7, color: '#666666', width: pageWidth, align: 'center' }); doc.end(); return result;
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