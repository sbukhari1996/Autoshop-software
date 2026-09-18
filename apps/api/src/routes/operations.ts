import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalText, requiredText } from '../validation.js';

const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const statuses = ['new', 'inspection', 'authorized', 'in_progress', 'ready', 'completed', 'cancelled'] as const;

export function createOperationsRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/jobs/:jobId/expenses', asyncHandler(async (req, res) => {
    const jobId = routeParam(req, 'jobId');
    await ensureJob(prisma, jobId);
    res.json(await prisma.jobExpense.findMany({ where: { jobId }, orderBy: { expenseDate: 'desc' } }));
  }));

  router.post('/jobs/:jobId/expenses', asyncHandler(async (req, res) => {
    const jobId = routeParam(req, 'jobId');
    await ensureJob(prisma, jobId);
    const description = requiredText(req.body.description, 'description');
    const amount = positiveAmount(req.body.amount);
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.jobExpense.create({ data: { jobId, description, amount, category: optionalText(req.body.category, 'category'), receiptFile: optionalText(req.body.receiptFile, 'receiptFile'), expenseDate: parseDate(req.body.expenseDate) } });
      await syncExpenseLedger(tx, created);
      await refreshExpenseTotal(tx, jobId);
      return created;
    });
    res.status(201).json(expense);
  }));

  router.patch('/expenses/:expenseId', asyncHandler(async (req, res) => {
    const existing = await prisma.jobExpense.findUnique({ where: { id: routeParam(req, 'expenseId') } });
    if (!existing) throw new ApiError(404, 'Expense not found');
    const expense = await prisma.$transaction(async (tx) => {
      const updated = await tx.jobExpense.update({ where: { id: existing.id }, data: { description: req.body.description === undefined ? undefined : requiredText(req.body.description, 'description'), amount: req.body.amount === undefined ? undefined : positiveAmount(req.body.amount), category: req.body.category === undefined ? undefined : optionalText(req.body.category, 'category'), receiptFile: req.body.receiptFile === undefined ? undefined : optionalText(req.body.receiptFile, 'receiptFile'), expenseDate: req.body.expenseDate === undefined ? undefined : parseDate(req.body.expenseDate) } });
      await syncExpenseLedger(tx, updated);
      await refreshExpenseTotal(tx, existing.jobId);
      return updated;
    });
    res.json(expense);
  }));

  router.delete('/expenses/:expenseId', asyncHandler(async (req, res) => {
    const existing = await prisma.jobExpense.findUnique({ where: { id: routeParam(req, 'expenseId') } });
    if (!existing) throw new ApiError(404, 'Expense not found');
    await prisma.$transaction(async (tx) => { await tx.financeEntry.deleteMany({ where: { sourceReference: `job-expense:${existing.id}` } }); await tx.jobExpense.delete({ where: { id: existing.id } }); await refreshExpenseTotal(tx, existing.jobId); });
    res.status(204).send();
  }));

  router.patch('/jobs/:jobId/status', asyncHandler(async (req, res) => {
    const job = await ensureJob(prisma, routeParam(req, 'jobId'));
    const nextStatus = requiredText(req.body.status, 'status');
    if (!(statuses as readonly string[]).includes(nextStatus)) throw new ApiError(400, `Unsupported job status: ${nextStatus}`);
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.job.update({ where: { id: job.id }, data: { status: nextStatus } });
      await tx.jobStatusHistory.create({ data: { jobId: job.id, fromStatus: job.status, toStatus: nextStatus, note: optionalText(req.body.note, 'note') } });
      return saved;
    });
    res.json(updated);
  }));

  router.post('/jobs/:jobId/authorization.pdf', asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: routeParam(req, 'jobId') }, include: { customer: true, vehicle: true, claim: true } });
    if (!job) throw new ApiError(404, 'Job not found');
    const authorizationId = randomUUID();
    const fileName = `repair-authorization-${job.jobNumber.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${authorizationId}.pdf`;
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(path.join(uploadDirectory, fileName), await createAuthorizationPdf(job));
    const authorization = await prisma.repairAuthorization.create({ data: { id: authorizationId, jobId: job.id, fileName, filePath: path.relative(process.cwd(), path.join(uploadDirectory, fileName)), status: 'generated' } });
    res.status(201).json({ ...authorization, downloadUrl: `/api/repair-authorizations/${authorization.id}/download` });
  }));

  router.get('/repair-authorizations/:authorizationId/download', asyncHandler(async (req, res) => {
    const authorization = await prisma.repairAuthorization.findUnique({ where: { id: routeParam(req, 'authorizationId') } });
    if (!authorization) throw new ApiError(404, 'Repair authorization not found');
    await sendStoredFile(res, authorization.filePath, authorization.fileName);
  }));

  router.get('/documents/:documentId/download', asyncHandler(async (req, res) => {
    const documentId = routeParam(req, 'documentId');
    const [claimDocument, jobDocument] = await Promise.all([
      prisma.claimDocument.findUnique({ where: { id: documentId } }),
      prisma.jobDocument.findUnique({ where: { id: documentId } }),
    ]);
    const document = claimDocument || jobDocument;
    if (!document) throw new ApiError(404, 'Document not found');
    await sendStoredFile(res, document.filePath, document.fileName);
  }));

  router.post('/documents/upload', upload.array('file', 20), asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!files.length || files.some((file) => file.size === 0)) throw new ApiError(400, 'at least one non-empty file is required');
    const claimId = optionalText(req.body.claimId, 'claimId');
    const jobId = optionalText(req.body.jobId, 'jobId');
    if ((claimId ? 1 : 0) + (jobId ? 1 : 0) !== 1) throw new ApiError(400, 'exactly one of claimId or jobId is required');
    if (claimId && !(await prisma.claim.findUnique({ where: { id: claimId }, select: { id: true } }))) throw new ApiError(404, 'Claim not found');
    if (jobId && !(await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new ApiError(404, 'Job not found');
    const documentType = requiredDocumentType(req.body.documentType);
    const description = optionalText(req.body.description, 'description');
    await mkdir(uploadDirectory, { recursive: true });
    const documents = [];
    for (const file of files) {
      const originalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
      const storedName = `${randomUUID()}-${originalName}`;
      await writeFile(path.join(uploadDirectory, storedName), file.buffer, { flag: 'wx' });
      const filePath = path.relative(process.cwd(), path.join(uploadDirectory, storedName));
      const document = claimId
        ? await prisma.claimDocument.create({ data: { claimId, fileName: originalName, filePath, documentType, description } })
        : await prisma.jobDocument.create({ data: { jobId: jobId!, fileName: originalName, filePath, documentType, description } });
      documents.push({ ...document, downloadUrl: `/api/documents/${document.id}/download` });
    }
    res.status(201).json({ documents });
  }));

  return router;
}

async function ensureJob(prisma: PrismaClient, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ApiError(404, 'Job not found');
  return job;
}

function routeParam(req: { params: Record<string, string | string[]> }, name: string) {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`);
  return value;
}

const documentTypes = ['accident_photos', 'license_photos', 'insurance_card', 'police_report', 'estimate', 'repair_authorization', 'invoice', 'parts_invoice', 'receipt', 'other'] as const;

function requiredDocumentType(value: unknown) {
  const documentType = requiredText(value, 'documentType');
  if (!(documentTypes as readonly string[]).includes(documentType)) throw new ApiError(400, `Unsupported documentType: ${documentType}`);
  return documentType;
}

async function sendStoredFile(res: { type: (value: string) => { send: (value: Buffer) => void } }, filePath: string, fileName: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const relativePath = path.relative(uploadDirectory, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new ApiError(400, 'Stored file path is invalid');
  try {
    await stat(resolvedPath);
    const contents = await readFile(resolvedPath);
    res.type(path.extname(fileName) || 'application/octet-stream').send(contents);
  } catch {
    throw new ApiError(404, 'Stored file not found');
  }
}

async function refreshExpenseTotal(tx: any, jobId: string) {
  const aggregate = await tx.jobExpense.aggregate({ where: { jobId }, _sum: { amount: true } });
  await tx.job.update({ where: { id: jobId }, data: { totalExpenses: aggregate._sum.amount || 0 } });
}

async function syncExpenseLedger(tx: any, expense: { id: string; jobId: string; description: string; amount: number; category: string | null; expenseDate: Date | null }) {
  const job = await tx.job.findUnique({ where: { id: expense.jobId }, select: { claimId: true } });
  await tx.financeEntry.upsert({
    where: { sourceReference: `job-expense:${expense.id}` },
    create: { sourceReference: `job-expense:${expense.id}`, type: 'expense', description: expense.description, category: expense.category, amount: expense.amount, entryDate: expense.expenseDate || new Date(), jobId: expense.jobId, claimId: job?.claimId || null },
    update: { type: 'expense', description: expense.description, category: expense.category, amount: expense.amount, entryDate: expense.expenseDate || new Date(), jobId: expense.jobId, claimId: job?.claimId || null },
  });
}

function positiveAmount(value: unknown) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(Number(value)) || Number(value) <= 0) throw new ApiError(400, 'amount must be a positive number');
  return Number(value);
}

function parseDate(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'expenseDate must be a valid date');
  return date;
}

function vehicleLabel(vehicle: { year: number | null; make: string | null; model: string | null } | null) {
  return vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : 'N/A';
}

function pdfEscape(value: string) { return value.replace(/([\\()])/g, '\\$1'); }
async function createAuthorizationPdf(job: {
  jobNumber: string;
  customer: { firstName: string; lastName: string; phone: string | null; address: string | null };
  vehicle: { year: number | null; make: string | null; model: string | null; bodyClass: string | null; vin: string | null; licensePlate: string | null; color: string | null } | null;
  claim: {
    claimNumber: string | null; customerAddress: string | null; customerPhone: string | null; customerInsurance: string | null;
    driverLicense: string | null; vehicleYear: number | null; vehicleMake: string | null; vehicleModel: string | null;
    vehicleBodyClass: string | null; vehicleVin: string | null; vehicleLicensePlate: string | null; vehicleColor: string | null;
    incidentDate: Date | null;
  } | null;
}) {
  const document = new PDFDocument({ size: 'LETTER', margin: 34 });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => document.on('end', () => resolve(Buffer.concat(chunks))));
  const pageWidth = 544;
  const customerName = `${job.customer.firstName} ${job.customer.lastName}`;
  const claim = job.claim;
  const vehicle = job.vehicle;
  const field = (label: string, content: string, x: number, width: number) => {
    document.font('Times-Roman').fontSize(8.5).text(`${label}:`, x, y, { continued: true });
    document.text(` ${content || ' '}`, { continued: false });
    document.moveTo(x + 1, y + 11).lineTo(x + width, y + 11).strokeColor('#555').stroke();
  };
  const section = (title: string, text: string) => {
    y += 15;
    document.font('Times-Bold').fontSize(10.5).text(title, 34, y, { width: pageWidth, align: 'center', underline: true });
    y += 13;
    document.font('Times-Roman').fontSize(8.7).text(text, 34, y, { width: pageWidth, lineGap: 0.2, align: 'left' });
    y += document.heightOfString(text, { width: pageWidth, lineGap: 0.2 });
    document.font('Times-Roman').fontSize(8.5).text('Initial here: ____________________', 390, y + 4, { width: 188, align: 'right' });
  };
  let y = 34;
  document.font('Times-Bold').fontSize(15).text('MASTERCRAFT AUTO REPAIR & COLLISION', 34, y, { width: pageWidth, align: 'center' });
  y += 18;
  document.font('Times-Roman').fontSize(8.4).text('38-21 23rd Street, Long Island City, NY 11101', 34, y, { width: pageWidth, align: 'center' });
  y += 11; document.text('Tel: (718) 603-0412  ·  (718) 578-4563', 34, y, { width: pageWidth, align: 'center' });
  y += 11; document.text('Website: www.mastercraftauto.com', 34, y, { width: pageWidth, align: 'center' });
  y += 11; document.text('Email: shop@mastercraftautony.com', 34, y, { width: pageWidth, align: 'center' });
  y += 5; document.font('Times-Italic').fontSize(9).text('Facility Number: 7136099', 34, y, { width: 170, align: 'left' }); document.text('EIN# 42-2914045', 430, y, { width: 148, align: 'right' });
  y += 12; document.moveTo(34, y).lineTo(578, y).stroke();
  y += 16; document.font('Times-Bold').fontSize(11).text('Recognized By All Insurance Companies', 34, y, { width: pageWidth, align: 'center', underline: true });
  y += 17;
  field('Date', new Date().toLocaleDateString('en-US'), 34, 102); field('Name (Person in Charge)', customerName, 145, 285); field('Claim#', claim?.claimNumber || '', 440, 138); y += 16;
  field('Address', claim?.customerAddress || job.customer.address || '', 34, 300); field('City', '', 340, 238); y += 16;
  field('State', '', 34, 105); field('Zip Code', '', 145, 120); field('Phone', claim?.customerPhone || job.customer.phone || '', 270, 205); field('Alt. Phone', '', 480, 98); y += 16;
  field('License No.', claim?.driverLicense || '', 34, 155); field('Insurance Company', claim?.customerInsurance || '', 195, 255); field('Date of Loss', claim?.incidentDate ? claim.incidentDate.toLocaleDateString('en-US') : '', 455, 123); y += 16;
  field('Year', String(vehicle?.year || claim?.vehicleYear || ''), 34, 80); field('Make', vehicle?.make || claim?.vehicleMake || '', 118, 112); field('Model', vehicle?.model || claim?.vehicleModel || '', 235, 145); field('Type', vehicle?.bodyClass || claim?.vehicleBodyClass || '', 385, 105); field('License No.', vehicle?.licensePlate || claim?.vehicleLicensePlate || '', 495, 83); y += 16;
  field('Vehicle Identification Number', vehicle?.vin || claim?.vehicleVin || '', 34, 370); field('Color', vehicle?.color || claim?.vehicleColor || '', 410, 168);
  section('Designated Representative Authorization', 'I (Above Owner) insured by: ______________________________ hereby authorize MASTERCRAFT AUTO REPAIR & COLLISION as my/our designated representative to reach an agreed price with the insurance company as to the reasonable cost to repair my/our vehicle. The designated authorization is in conformance with New York State Department Regulations No.64 and is NOT an authorization to repair.');
  section('Authorization To Repair', 'I (Above Owner) hereby authorize MASTERCRAFT AUTO REPAIR & COLLISION to test drive my vehicle while the vehicle is in their possession.\n\nAS AGREED TO REPAIR FOR INSURANCE COMPANY PRICE ONLY AND AS PER SHOP ESTIMATE\nTO OWNER OR PERSON IN CHARGE OF DAMAGE VEHICLE:\n\nPlease read all printed matter before signing, all complaints of quality of repairs must be made to the New York State Department of Motor Vehicle. No Towing Company or Insurance may require that repair be made to a motor vehicle in a particular place or repair shop. You have the right to have your motor vehicle repaired in the shop of your choice.\n1. Do Not Sign this "Authorization to Repair" at the scene of an accident. You can not be required to do so\n    SIGN ONLY AT:\n    (a) The place to which the vehicle is towed to, or\n    (b) Your home or place designated by the person in charge of the disabled vehicle, or\n    (c) The hospital, if you are hospitalized by not before twenty-four (24) hours after the accident unless you are discharged from hospital before that period of time.\n2. Before signing your name to the bottom of this form, print/write in your own handwriting in the spaces provided I authorize the repair of the vehicle indicated above.');
  section('Authorization To Dismantle', 'I (Above Owner) hereby authorize MASTERCRAFT AUTO REPAIR & COLLISION to dismantle my vehicle prior/after Insurance Co. inspection to see any hidden and related damage. MASTERCRAFT AUTO REPAIR & COLLISION hourly rate of $75.00 per hour maximum time of dismantling __________ hours. I also allow MASTERCRAFT AUTO REPAIR & COLLISION to place my vehicle in any one of their location while in their possession.');
  section('Direction of Payment', 'I (Above Owner) hereby authorize ______________________________ on my claim# __________________ to directly pay MASTERCRAFT AUTO REPAIR & COLLISION. I understand that by signing this authorization, I will give permission to also make 2 party check.');
  section('Department of Motor Vehicles Notification', 'I Authorize MASTERCRAFT AUTO REPAIR & COLLISION to charge $150.00 per day storage for above vehicle upon completion of repairs or if vehicle redeemed a total loss.');
  y += 9;
  const tableY = y;
  document.font('Times-Bold').fontSize(8.5); document.rect(34, tableY, pageWidth, 24).stroke(); document.moveTo(218, tableY).lineTo(218, tableY + 24).stroke(); document.moveTo(402, tableY).lineTo(402, tableY + 24).stroke();
  document.text('Owner/person in charge (Print Name)', 39, tableY + 5); document.text('Signature', 223, tableY + 5); document.text('Date', 407, tableY + 5);
  y = tableY + 45; field('Address where signed', '', 34, 270); field('City', '', 310, 125); field('State / Zip-Code', '', 440, 138);
  y += 23; document.font('Times-Bold').fontSize(8.7).text('ALL OF THE ABOVE ENTRIES MUST BE MADE AT THE TIME THE AUTHORIZATION TO REPAIR IS SIGNED.', 34, y, { width: pageWidth, align: 'center' });
  document.end();
  return finished;
}