import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { signedAuthorizationDownloadName } from '../authorization-document-name.js';
import type { AuthorizationFieldPlacement } from '../authorization-fields.js';
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
      await refreshExpenseTotal(tx, existing.jobId);
      return updated;
    });
    res.json(expense);
  }));

  router.delete('/expenses/:expenseId', asyncHandler(async (req, res) => {
    const existing = await prisma.jobExpense.findUnique({ where: { id: routeParam(req, 'expenseId') } });
    if (!existing) throw new ApiError(404, 'Expense not found');
    await prisma.$transaction(async (tx) => { await tx.jobExpense.delete({ where: { id: existing.id } }); await refreshExpenseTotal(tx, existing.jobId); });
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
    res.status(201).json(await createStoredAuthorization(prisma, {
      jobId: job.id,
      claimId: job.claimId,
      reference: job.jobNumber,
    }, job));
  }));

  router.post('/claims/:claimId/authorization.pdf', asyncHandler(async (req, res) => {
    const claim = await prisma.claim.findUnique({
      where: { id: routeParam(req, 'claimId') },
      include: { customer: true, vehicle: true },
    });
    if (!claim) throw new ApiError(404, 'Claim not found');
    res.status(201).json(await createStoredAuthorization(prisma, {
      jobId: null,
      claimId: claim.id,
      reference: claim.claimNumber || claim.id,
    }, {
      jobNumber: claim.claimNumber || claim.id,
      customer: claim.customer,
      vehicle: claim.vehicle,
      claim,
    }));
  }));

  router.get('/repair-authorizations/:authorizationId/download', asyncHandler(async (req, res) => {
    const authorization = await prisma.repairAuthorization.findUnique({ where: { id: routeParam(req, 'authorizationId') } });
    if (!authorization) throw new ApiError(404, 'Repair authorization not found');
    const hasUnresolvedEnvelope = Boolean(authorization.documensoEnvelopeId && !authorization.documensoCompletedAt);
    if (!authorization.legacyDocuSealSubmissionId && !hasUnresolvedEnvelope) {
      await regenerateAuthorizationPdf(prisma, authorization.id);
    }
    await sendStoredFile(res, authorization.filePath, authorization.fileName);
  }));

  router.get('/documents/:documentId/download', asyncHandler(async (req, res) => {
    const documentId = routeParam(req, 'documentId');
    const [claimDocument, jobDocument, customerDocument] = await Promise.all([
      prisma.claimDocument.findUnique({ where: { id: documentId }, include: { claim: { select: { customer: { select: { firstName: true, lastName: true } } } } } }),
      prisma.jobDocument.findUnique({ where: { id: documentId }, include: { job: { select: { customer: { select: { firstName: true, lastName: true } } } } } }),
      prisma.customerDocument.findUnique({ where: { id: documentId }, include: { customer: { select: { firstName: true, lastName: true } } } }),
    ]);
    const document = claimDocument || jobDocument || customerDocument;
    if (!document) throw new ApiError(404, 'Document not found');
    const customer = claimDocument?.claim.customer || jobDocument?.job.customer || customerDocument?.customer;
    const customerName = `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim();
    const downloadName = signedAuthorizationDownloadName(document.fileName, document.documentType, customerName);
    await sendStoredFile(res, document.filePath, downloadName);
  }));

  router.delete('/documents/:documentId', asyncHandler(async (req, res) => {
    const documentId = routeParam(req, 'documentId');
    const [claimDocument, jobDocument, customerDocument] = await Promise.all([
      prisma.claimDocument.findUnique({ where: { id: documentId } }),
      prisma.jobDocument.findUnique({ where: { id: documentId } }),
      prisma.customerDocument.findUnique({ where: { id: documentId } }),
    ]);
    const document = claimDocument || jobDocument || customerDocument;
    if (!document) throw new ApiError(404, 'Document not found');
    await removeStoredFile(document.filePath);
    if (claimDocument) await prisma.claimDocument.delete({ where: { id: documentId } });
    else if (jobDocument) await prisma.jobDocument.delete({ where: { id: documentId } });
    else await prisma.customerDocument.delete({ where: { id: documentId } });
    res.status(204).send();
  }));

  router.post('/documents/upload', upload.array('file', 20), asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!files.length || files.some((file) => file.size === 0)) throw new ApiError(400, 'at least one non-empty file is required');
    const claimId = optionalText(req.body.claimId, 'claimId');
    const jobId = optionalText(req.body.jobId, 'jobId');
    const customerId = optionalText(req.body.customerId, 'customerId');
    if ((claimId ? 1 : 0) + (jobId ? 1 : 0) + (customerId ? 1 : 0) !== 1) throw new ApiError(400, 'exactly one of claimId, jobId, or customerId is required');
    if (claimId && !(await prisma.claim.findUnique({ where: { id: claimId }, select: { id: true } }))) throw new ApiError(404, 'Claim not found');
    if (jobId && !(await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new ApiError(404, 'Job not found');
    if (customerId && !(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) throw new ApiError(404, 'Customer not found');
    const documentType = requiredDocumentType(req.body.documentType || 'other');
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
        : jobId
          ? await prisma.jobDocument.create({ data: { jobId, fileName: originalName, filePath, documentType, description } })
          : await prisma.customerDocument.create({ data: { customerId: customerId!, fileName: originalName, filePath, documentType, description } });
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

async function sendStoredFile(res: { type: (value: string) => { set: (name: string, value: string) => { send: (value: Buffer) => void } } }, filePath: string, fileName: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const relativePath = path.relative(uploadDirectory, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new ApiError(400, 'Stored file path is invalid');
  try {
    await stat(resolvedPath);
    const contents = await readFile(resolvedPath);
    const safeDownloadName = fileName.replace(/["\\\r\n]/g, '_');
    res.type(path.extname(fileName) || 'application/octet-stream')
      .set('Content-Disposition', `attachment; filename="${safeDownloadName}"`)
      .send(contents);
  } catch {
    throw new ApiError(404, 'Stored file not found');
  }
}

async function removeStoredFile(filePath: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const relativePath = path.relative(uploadDirectory, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new ApiError(400, 'Stored file path is invalid');
  try {
    await unlink(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, 'Stored file not found');
    throw error;
  }
}

async function refreshExpenseTotal(tx: any, jobId: string) {
  const aggregate = await tx.jobExpense.aggregate({ where: { jobId }, _sum: { amount: true } });
  await tx.job.update({ where: { id: jobId }, data: { totalExpenses: aggregate._sum.amount || 0 } });
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

async function createStoredAuthorization(
  prisma: PrismaClient,
  owner: { jobId: string | null; claimId: string | null; reference: string },
  data: Parameters<typeof createAuthorizationPdf>[0],
) {
  const authorizationId = randomUUID();
  const safeReference = owner.reference.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const fileName = `repair-authorization-${safeReference}-${authorizationId}.pdf`;
  const filePath = path.join(uploadDirectory, fileName);
  await mkdir(uploadDirectory, { recursive: true });
  const generated = await createAuthorizationPdf(data);
  await writeFile(filePath, generated.pdf);
  const authorization = await prisma.repairAuthorization.create({
    data: {
      id: authorizationId,
      jobId: owner.jobId,
      claimId: owner.claimId,
      fileName,
      filePath: path.relative(process.cwd(), filePath),
      authorizationFields: JSON.stringify(generated.fieldPlacements),
      status: 'generated',
    },
  });
  return { ...authorization, downloadUrl: `/api/repair-authorizations/${authorization.id}/download` };
}

export async function regenerateAuthorizationPdf(prisma: PrismaClient, authorizationId: string) {
  const authorization = await prisma.repairAuthorization.findUnique({
    where: { id: authorizationId },
    include: {
      job: { include: { customer: true, vehicle: true, claim: true } },
      claim: { include: { customer: true, vehicle: true } },
    },
  });
  if (!authorization) throw new ApiError(404, 'Repair authorization not found');

  const pdfData = authorization.job
    ? authorization.job
    : authorization.claim
      ? {
        jobNumber: authorization.claim.claimNumber || authorization.claim.id,
        customer: authorization.claim.customer,
        vehicle: authorization.claim.vehicle,
        claim: authorization.claim,
      }
      : null;
  if (!pdfData) throw new ApiError(500, 'Repair authorization has no claim or repair order');

  const targetPath = path.resolve(process.cwd(), authorization.filePath);
  const relativePath = path.relative(uploadDirectory, targetPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new ApiError(400, 'Stored authorization PDF path is invalid');
  }
  const generated = await createAuthorizationPdf(pdfData);
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, generated.pdf, { flag: 'wx' });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }

  const authorizationFields = JSON.stringify(generated.fieldPlacements);
  await prisma.repairAuthorization.update({
    where: { id: authorization.id },
    data: { authorizationFields },
  });
  return { filePath: authorization.filePath, fileName: authorization.fileName, pdf: generated.pdf, authorizationFields };
}

async function createAuthorizationPdf(job: {
  jobNumber: string;
  customer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  };
  vehicle: { year: number | null; make: string | null; model: string | null; bodyClass: string | null; vin: string | null; licensePlate: string | null; color: string | null } | null;
  claim: {
    claimNumber: string | null; customerAddress: string | null; customerPhone: string | null; customerInsurance: string | null; atFaultInsurance: string | null;
    driverLicense: string | null; vehicleYear: number | null; vehicleMake: string | null; vehicleModel: string | null;
    vehicleBodyClass: string | null; vehicleVin: string | null; vehicleLicensePlate: string | null; vehicleColor: string | null;
    incidentDate: Date | null;
  } | null;
}) {
  const document = new PDFDocument({ size: 'LETTER', margin: 34 });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => document.on('end', () => resolve(Buffer.concat(chunks))));
  const fieldPlacements: AuthorizationFieldPlacement[] = [];
  const pageWidth = 544;
  const customerName = `${job.customer.firstName} ${job.customer.lastName}`;
  const claim = job.claim;
  const vehicle = job.vehicle;
  const customerAddress = splitAuthorizationAddress(job.customer.address || claim?.customerAddress || '');
  const claimAddress = splitAuthorizationAddress(claim?.customerAddress || job.customer.address || '');
  const addressLine = job.customer.city || job.customer.state || job.customer.zipCode
    ? customerAddress.street
    : claimAddress.street;
  const city = job.customer.city || customerAddress.city || claimAddress.city;
  const state = job.customer.state || customerAddress.state || claimAddress.state;
  const zipCode = job.customer.zipCode || customerAddress.zipCode || claimAddress.zipCode;
  const field = (label: string, content: string, x: number, width: number) => {
    document.font('Times-Roman').fontSize(9);
    const labelText = `${label}:`;
    document.text(labelText, x, y, { continued: true });
    const availableWidth = Math.max(0, width - document.widthOfString(labelText) - 3);
    document.text(` ${fitTextToWidth(content || ' ', availableWidth, document.widthOfString.bind(document))}`, { continued: false });
    document.moveTo(x + 1, y + 12).lineTo(x + width, y + 12).strokeColor('#555').stroke();
  };
  const section = (title: string, text: string, renderBody?: (bodyY: number) => void) => {
    y += 15;
    document.font('Times-Bold').fontSize(11).text(title, 34, y, { width: pageWidth, align: 'center', underline: true });
    y += 13;
    const bodyY = y;
    document.font('Times-Roman').fontSize(9.1);
    if (renderBody) renderBody(bodyY);
    else document.text(text, 34, bodyY, { width: pageWidth, lineGap: 0.2, align: 'left' });
    y += document.heightOfString(text, { width: pageWidth, lineGap: 0.2 });
    const initialText = 'Initial here: x ____________________';
    const initialUnderline = '____________________';
    document.font('Times-Roman').fontSize(9);
    document.text(initialText, 390, y + 4, { width: 188, align: 'right' });
    const initialTextX = 390 + 188 - document.widthOfString(initialText);
    fieldPlacements.push({
      name: `${title} initials`,
      type: 'initials',
      required: true,
      x: initialTextX + document.widthOfString('Initial here: x '),
      y: y + 5,
      w: document.widthOfString(initialUnderline),
      h: 9,
      page: 1,
    });
  };
  let y = 34;
  document.font('Times-Bold').fontSize(16).text('MASTERCRAFT AUTO REPAIR & COLLISION', 34, y, { width: pageWidth, align: 'center' });
  y += 18;
  document.font('Times-Roman').fontSize(9).text('38-21 23rd Street, Long Island City, NY 11101', 34, y, { width: pageWidth, align: 'center' });
  y += 11; document.text('Tel: (718) 603-0412  ·  (718) 578-4563', 34, y, { width: pageWidth, align: 'center' });
  y += 11; document.text('Website: www.mastercraftauto.com', 34, y, { width: pageWidth, align: 'center' });
  y += 11; document.text('Email: shop@mastercraftautony.com', 34, y, { width: pageWidth, align: 'center' });
  y += 5; document.font('Times-Italic').fontSize(9).text('Facility Number: 7136099', 34, y, { width: 170, align: 'left' }); document.text('EIN# 42-2914045', 430, y, { width: 148, align: 'right' });
  y += 12; document.moveTo(34, y).lineTo(578, y).stroke();
  y += 16; document.font('Times-Bold').fontSize(11).text('Recognized By All Insurance Companies', 34, y, { width: pageWidth, align: 'center', underline: true });
  y += 17;
  field('Date', new Date().toLocaleDateString('en-US'), 34, 102); field('Name (Person in Charge)', customerName, 145, 285); field('Claim#', claim?.claimNumber || '', 440, 138); y += 16;
  field('Address', addressLine, 34, 300); field('City', city, 340, 238); y += 16;
  field('State', state, 34, 105); field('Zip Code', zipCode, 145, 120); field('Phone', claim?.customerPhone || job.customer.phone || '', 270, 205); field('Alt. Phone', '', 480, 98); y += 16;
  field('License No.', claim?.driverLicense || '', 34, 155); field('Insurance Company', claim?.customerInsurance || '', 195, 255); field('Date of Loss', claim?.incidentDate ? claim.incidentDate.toLocaleDateString('en-US') : '', 455, 123); y += 16;
  field('Year', String(vehicle?.year || claim?.vehicleYear || ''), 34, 80); field('Make', vehicle?.make || claim?.vehicleMake || '', 118, 112); field('Model', vehicle?.model || claim?.vehicleModel || '', 235, 145); field('Type', vehicle?.bodyClass || claim?.vehicleBodyClass || '', 385, 105); field('License No.', vehicle?.licensePlate || claim?.vehicleLicensePlate || '', 495, 83); y += 16;
  field('Vehicle Identification Number', vehicle?.vin || claim?.vehicleVin || '', 34, 370); field('Color', vehicle?.color || claim?.vehicleColor || '', 410, 168);
  section('Designated Representative Authorization', 'I (Above Owner) insured by: ______________________________ hereby authorize MASTERCRAFT AUTO REPAIR & COLLISION as my/our designated representative to reach an agreed price with the insurance company as to the reasonable cost to repair my/our vehicle. The designated authorization is in conformance with New York State Department Regulations No.64 and is NOT an authorization to repair.');
  section('Authorization To Repair', 'I (Above Owner) hereby authorize MASTERCRAFT AUTO REPAIR & COLLISION to test drive my vehicle while the vehicle is in their possession.\n\nAS AGREED TO REPAIR FOR INSURANCE COMPANY PRICE ONLY AND AS PER SHOP ESTIMATE\nTO OWNER OR PERSON IN CHARGE OF DAMAGE VEHICLE:\n\nPlease read all printed matter before signing, all complaints of quality of repairs must be made to the New York State Department of Motor Vehicle. No Towing Company or Insurance may require that repair be made to a motor vehicle in a particular place or repair shop. You have the right to have your motor vehicle repaired in the shop of your choice.\n1. Do Not Sign this "Authorization to Repair" at the scene of an accident. You can not be required to do so\n    SIGN ONLY AT:\n    (a) The place to which the vehicle is towed to, or\n    (b) Your home or place designated by the person in charge of the disabled vehicle, or\n    (c) The hospital, if you are hospitalized by not before twenty-four (24) hours after the accident unless you are discharged from hospital before that period of time.\n2. Before signing your name to the bottom of this form, print/write in your own handwriting in the spaces provided I authorize the repair of the vehicle indicated above.');
  section('Authorization To Dismantle', 'I (Above Owner) hereby authorize MASTERCRAFT AUTO REPAIR & COLLISION to dismantle my vehicle prior/after Insurance Co. inspection to see any hidden and related damage. MASTERCRAFT AUTO REPAIR & COLLISION hourly rate of $75.00 per hour maximum time of dismantling __________ hours. I also allow MASTERCRAFT AUTO REPAIR & COLLISION to place my vehicle in any one of their location while in their possession.');
  const paymentText = `I (Above Owner) hereby authorize ${claim?.atFaultInsurance || ''} on my claim# ${claim?.claimNumber || ''} to directly pay MASTERCRAFT AUTO REPAIR & COLLISION. I understand that by signing this authorization, I will give permission to also make 2 party check.`;
  section('Direction of Payment', paymentText);
  section('Department of Motor Vehicles Notification', 'I Authorize MASTERCRAFT AUTO REPAIR & COLLISION to charge $150.00 per day storage for above vehicle upon completion of repairs or if vehicle redeemed a total loss.');
  y += 9;
  const tableY = y;
  document.font('Times-Bold').fontSize(9); document.rect(34, tableY, pageWidth, 24).stroke(); document.moveTo(218, tableY).lineTo(218, tableY + 24).stroke(); document.moveTo(402, tableY).lineTo(402, tableY + 24).stroke();
  document.text('Owner/person in charge (Print Name)', 39, tableY + 5); document.font('Times-Roman').fontSize(9).text(customerName || ' ', 39, tableY + 15, { width: 175 }); document.font('Times-Bold').fontSize(9).text('Signature', 223, tableY + 5); document.text('Date', 407, tableY + 5);
  y = tableY + 45; field('Address where signed', '38-21 23rd St', 34, 270); field('City', 'Long Island City', 310, 125); field('State / Zip-Code', 'NY 11101', 440, 138);
  y += 23; document.font('Times-Bold').fontSize(9.1).text('ALL OF THE ABOVE ENTRIES MUST BE MADE AT THE TIME THE AUTHORIZATION TO REPAIR IS SIGNED.', 34, y, { width: pageWidth, align: 'center' });
  fieldPlacements.push(
    { name: 'Signature', type: 'signature', required: true, x: 223, y: tableY + 14.5, w: 173, h: 8.5, page: 1 },
    { name: 'Date', type: 'date', required: true, x: 407, y: tableY + 14.5, w: 166, h: 8.5, page: 1 },
  );
  document.end();
  return { pdf: await finished, fieldPlacements };
}

function fitTextToWidth(text: string, maxWidth: number, measure: (text: string) => number) {
  if (measure(text) <= maxWidth) return text;
  const ellipsis = '...';
  if (measure(ellipsis) > maxWidth) return '';
  let fitted = text;
  while (fitted.length && measure(`${fitted}${ellipsis}`) > maxWidth) fitted = fitted.slice(0, -1);
  return `${fitted.trimEnd()}${ellipsis}`;
}

function splitAuthorizationAddress(value: string) {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { street: value.trim(), city: '', state: '', zipCode: '' };

  const lastPart = parts[parts.length - 1];
  const zipMatch = lastPart.match(/\b\d{5}(?:-\d{4})?\b/);
  const stateMatch = lastPart.match(/\b([A-Z]{2})\b/i);
  const stateIndex = stateMatch ? parts.length - 1 : zipMatch && parts.length > 1
    ? parts.length - 2
    : -1;
  const stateValue = stateMatch?.[1] || (stateIndex >= 0 ? parts[stateIndex].match(/\b([A-Z]{2})\b/i)?.[1] : '');
  if (!stateValue || stateIndex < 1) {
    return { street: value.trim(), city: '', state: '', zipCode: zipMatch?.[0] || '' };
  }

  const cityIndex = stateIndex - 1;
  return {
    street: parts.slice(0, cityIndex).join(', '),
    city: parts[cityIndex],
    state: stateValue.toUpperCase(),
    zipCode: zipMatch?.[0] || '',
  };
}