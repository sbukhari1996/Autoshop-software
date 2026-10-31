import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { invoicePdfBytes, nextInvoiceNumber } from './invoices.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import { createRentalAgreementPdf, SHOP, type RentalAgreementPdfInput } from '../rentalAgreement.js';
import {
  createRepairAuthorizationEnvelope,
  distributeDocumensoEnvelope,
  getDocumensoApiConfig,
  getDocumensoEnvelope,
  getSignedDocumensoDocument,
} from '../documenso.js';

const carStatuses = ['available', 'in_repair', 'out_of_service'];
const agreementStatuses = ['draft', 'sent', 'signed', 'returned'];
const fuelLevels = ['Full', '3/4', '1/2', '1/4'];
// Agreements in these states hold the car for their dates. Returned agreements free it.
const holdingStatuses = ['draft', 'sent', 'signed'];
const DAY_MS = 86400000;

const idOf = (req: { params: Record<string, string | string[]> }) => (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
const text = (value: unknown, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const round2 = (value: number) => Math.round(value * 100) / 100;

function money(value: unknown, field: string, max = 100000) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number) || number < 0 || number > max) throw new ApiError(400, `${field} must be a number from 0 to ${max}`);
  return round2(number);
}

function date(value: unknown, field: string) {
  const parsed = new Date(typeof value === 'string' ? value : '');
  if (Number.isNaN(parsed.getTime())) throw new ApiError(400, `${field} is not a valid date`);
  return parsed;
}

// Whole rental days, at least one. 4 days at $28 is $112 before tax.
export function rentalTotals(dailyRate: number, startDate: Date, endDate: Date, taxRate: number) {
  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS));
  const subtotal = round2(dailyRate * days);
  const tax = round2((subtotal * taxRate) / 100);
  return { days, subtotal, tax, total: round2(subtotal + tax) };
}

async function assertCarFree(prisma: PrismaClient, rentalCarId: string, startDate: Date, endDate: Date, exceptId?: string) {
  const clash = await prisma.rentalAgreement.findFirst({
    where: {
      rentalCarId,
      status: { in: holdingStatuses },
      startDate: { lt: endDate },
      endDate: { gt: startDate },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { agreementNumber: true, startDate: true, endDate: true },
  });
  if (clash) {
    throw new ApiError(409, `This car is already booked on ${clash.startDate.toLocaleDateString('en-US')} to ${clash.endDate.toLocaleDateString('en-US')} (${clash.agreementNumber})`);
  }
}

async function nextAgreementNumber(prisma: PrismaClient) {
  const count = await prisma.rentalAgreement.count();
  for (let n = count + 1; n < count + 100; n += 1) {
    const agreementNumber = `RA-${String(n).padStart(4, '0')}`;
    if (!(await prisma.rentalAgreement.findUnique({ where: { agreementNumber }, select: { id: true } }))) return agreementNumber;
  }
  throw new ApiError(500, 'Could not create an agreement number, try again');
}

export function createRentalsRouter(prisma: PrismaClient) {
  const router = Router();

  // ----- Fleet -----
  router.get('/rental-cars', asyncHandler(async (_req, res) => {
    res.json(await prisma.rentalCar.findMany({ orderBy: { name: 'asc' } }));
  }));

  router.post('/rental-cars', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const name = text(body.name, 80);
    if (!name) throw new ApiError(400, 'Give the car a name or number, for example Car 1');
    const status = carStatuses.includes(body.status) ? body.status : 'available';
    res.status(201).json(await prisma.rentalCar.create({
      data: {
        name,
        vin: text(body.vin, 32),
        licensePlate: text(body.licensePlate, 16),
        licenseState: text(body.licenseState, 4),
        year: body.year ? Math.trunc(Number(body.year)) : null,
        make: text(body.make, 60),
        model: text(body.model, 60),
        color: text(body.color, 30),
        dailyRate: money(body.dailyRate ?? 0, 'Daily rate'),
        status,
        notes: text(body.notes, 500),
      },
    }));
  }));

  router.put('/rental-cars/:id', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = text(body.name, 80) ?? (() => { throw new ApiError(400, 'Car name is required'); })();
    if (body.dailyRate !== undefined) data.dailyRate = money(body.dailyRate, 'Daily rate');
    if (body.status !== undefined) {
      if (!carStatuses.includes(body.status)) throw new ApiError(400, 'Unknown car status');
      data.status = body.status;
    }
    for (const key of ['vin', 'licensePlate', 'licenseState', 'make', 'model', 'color', 'notes'] as const) {
      if (body[key] !== undefined) data[key] = text(body[key], key === 'notes' ? 500 : 60);
    }
    if (body.year !== undefined) data.year = body.year ? Math.trunc(Number(body.year)) : null;
    res.json(await prisma.rentalCar.update({ where: { id: idOf(req) }, data }));
  }));

  // ----- Agreements (the rental log) -----
  router.get('/rental-agreements', asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = {};
    if (typeof req.query.claimId === 'string' && req.query.claimId) where.claimId = req.query.claimId;
    if (typeof req.query.status === 'string' && agreementStatuses.includes(req.query.status)) where.status = req.query.status;
    res.json(await prisma.rentalAgreement.findMany({ where, orderBy: { createdAt: 'desc' }, include: { rentalCar: true }, take: 500 }));
  }));

  router.get('/rental-agreements/:id', asyncHandler(async (req, res) => {
    const row = await prisma.rentalAgreement.findUnique({ where: { id: idOf(req) }, include: { rentalCar: true } });
    if (!row) throw new ApiError(404, 'Rental agreement not found');
    res.json(row);
  }));

  router.post('/rental-agreements', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const car = await prisma.rentalCar.findUnique({ where: { id: String(body.rentalCarId ?? '') } });
    if (!car) throw new ApiError(400, 'Choose a rental car');
    if (car.status !== 'available') throw new ApiError(409, `${car.name} is ${car.status.replace('_', ' ')} and cannot be rented`);
    const customerName = text(body.customerName, 120);
    if (!customerName) throw new ApiError(400, 'Customer name is required');
    const startDate = date(body.startDate, 'Start date');
    const endDate = date(body.endDate, 'Return date');
    if (endDate <= startDate) throw new ApiError(400, 'Return date must be after the start date');
    await assertCarFree(prisma, car.id, startDate, endDate);
    const dailyRate = money(body.dailyRate ?? car.dailyRate, 'Daily rate');
    const taxRate = money(body.taxRate ?? 0, 'Tax rate', 30);
    const totals = rentalTotals(dailyRate, startDate, endDate, taxRate);
    const agreementNumber = await nextAgreementNumber(prisma);
    const row = await prisma.rentalAgreement.create({
      data: {
        agreementNumber,
        rentalCarId: car.id,
        claimId: text(body.claimId, 60),
        customerId: text(body.customerId, 60),
        customerName,
        customerPhone: text(body.customerPhone, 40),
        customerEmail: text(body.customerEmail, 200),
        customerAddress: text(body.customerAddress, 300),
        insuranceCompany: text(body.insuranceCompany, 120),
        claimNumber: text(body.claimNumber, 60),
        adjusterName: text(body.adjusterName, 120),
        adjusterPhone: text(body.adjusterPhone, 40),
        adjusterEmail: text(body.adjusterEmail, 200),
        startDate,
        endDate,
        dailyRate,
        taxRate,
        ...totals,
        mileageOut: body.mileageOut ? Math.trunc(Number(body.mileageOut)) : null,
        fuelOut: fuelLevels.includes(body.fuelOut) ? body.fuelOut : null,
        conditionOut: text(body.conditionOut, 20),
        damageNotes: text(body.damageNotes, 1000),
        notes: text(body.notes, 1000),
      },
      include: { rentalCar: true },
    });
    res.status(201).json(row);
  }));

  // Edits to rate, dates, tax, mileage, fuel, condition and status. Dates are rechecked against other bookings.
  router.put('/rental-agreements/:id', asyncHandler(async (req, res) => {
    const current = await prisma.rentalAgreement.findUnique({ where: { id: idOf(req) } });
    if (!current) throw new ApiError(404, 'Rental agreement not found');
    const body = req.body ?? {};
    // Once sent for signature, the terms are what the customer signs. Only return details can still change.
    if (current.documensoEnvelopeId) {
      const terms = ['customerName', 'customerPhone', 'customerEmail', 'customerAddress', 'insuranceCompany', 'claimNumber', 'adjusterName', 'adjusterPhone', 'adjusterEmail', 'startDate', 'endDate', 'dailyRate', 'taxRate'] as const;
      const changed = terms.filter((key) => {
        if (body[key] === undefined) return false;
        const stored = current[key];
        if (stored instanceof Date) return new Date(String(body[key])).getTime() !== stored.getTime();
        return String(body[key] ?? '').trim() !== String(stored ?? '').trim();
      });
      if (changed.length) throw new ApiError(409, 'This agreement was sent for signature, so its terms are locked. Create a new agreement to change them.');
    }
    const data: Record<string, unknown> = {};
    for (const key of ['customerName', 'customerPhone', 'customerEmail', 'customerAddress', 'insuranceCompany', 'claimNumber', 'adjusterName', 'adjusterPhone', 'adjusterEmail', 'conditionOut', 'conditionIn', 'damageNotes', 'notes'] as const) {
      if (body[key] !== undefined) data[key] = text(body[key], key === 'damageNotes' || key === 'notes' ? 1000 : 200);
    }
    if (data.customerName === null) throw new ApiError(400, 'Customer name is required');
    for (const key of ['mileageOut', 'mileageIn'] as const) {
      if (body[key] !== undefined) data[key] = body[key] === '' || body[key] === null ? null : Math.trunc(Number(body[key]));
    }
    for (const key of ['fuelOut', 'fuelIn'] as const) {
      if (body[key] !== undefined) data[key] = fuelLevels.includes(body[key]) ? body[key] : null;
    }
    if (body.status !== undefined) {
      if (!agreementStatuses.includes(body.status)) throw new ApiError(400, 'Unknown agreement status');
      data.status = body.status;
      if (body.status === 'returned' && !current.returnedAt) data.returnedAt = new Date();
    }
    const startDate = body.startDate !== undefined ? date(body.startDate, 'Start date') : current.startDate;
    const endDate = body.endDate !== undefined ? date(body.endDate, 'Return date') : current.endDate;
    if (endDate <= startDate) throw new ApiError(400, 'Return date must be after the start date');
    const dailyRate = body.dailyRate !== undefined ? money(body.dailyRate, 'Daily rate') : current.dailyRate;
    const taxRate = body.taxRate !== undefined ? money(body.taxRate, 'Tax rate', 30) : current.taxRate;
    const datesChanged = startDate.getTime() !== current.startDate.getTime() || endDate.getTime() !== current.endDate.getTime();
    const willHold = holdingStatuses.includes(String(data.status ?? current.status));
    if (willHold && (datesChanged || data.status)) await assertCarFree(prisma, current.rentalCarId, startDate, endDate, current.id);
    Object.assign(data, { startDate, endDate, dailyRate, taxRate, ...rentalTotals(dailyRate, startDate, endDate, taxRate) });
    res.json(await prisma.rentalAgreement.update({ where: { id: current.id }, data, include: { rentalCar: true } }));
  }));

  // Creates a normal invoice from the agreement. The insurer is billed by default; a customer invoice uses the customer's details.
  // Only agreements that were never sent or signed can be deleted. Invoices must be removed first.
  router.delete('/rental-agreements/:id', asyncHandler(async (req, res) => {
    const current = await prisma.rentalAgreement.findUnique({ where: { id: idOf(req) } });
    if (!current) throw new ApiError(404, 'Rental agreement not found');
    if (current.documensoEnvelopeId || current.signedFilePath) throw new ApiError(409, 'This agreement was sent or signed and cannot be deleted');
    if (current.invoiceId) throw new ApiError(409, 'Delete the invoice for this agreement first');
    await prisma.rentalAgreement.delete({ where: { id: current.id } });
    res.status(204).end();
  }));

  router.post('/rental-agreements/:id/invoice', asyncHandler(async (req, res) => {
    const agreement = await prisma.rentalAgreement.findUnique({ where: { id: idOf(req) }, include: { rentalCar: true } });
    if (!agreement) throw new ApiError(404, 'Rental agreement not found');
    if (agreement.invoiceId) throw new ApiError(409, 'This agreement already has an invoice');
    const billToCustomer = req.body?.billTo === 'customer';
    const billing = billToCustomer
      ? { customerName: agreement.customerName, customerPhone: agreement.customerPhone, customerEmail: agreement.customerEmail, customerAddress: agreement.customerAddress }
      : {
          customerName: agreement.insuranceCompany || 'Insurance company',
          customerPhone: agreement.adjusterPhone,
          customerEmail: agreement.adjusterEmail,
          customerAddress: null,
        };
    const note = billToCustomer
      ? `Car rental ${agreement.agreementNumber}`
      : `Car rental ${agreement.agreementNumber}. Insurance claim ${agreement.claimNumber || 'pending'}. Adjuster ${agreement.adjusterName || 'not set'}.`;
    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx);
      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: agreement.customerId,
          claimId: agreement.claimId,
          ...billing,
          status: 'draft',
          issueDate: new Date(),
          subtotal: agreement.subtotal,
          tax: agreement.tax,
          total: agreement.total,
          balanceDue: agreement.total,
          notes: note,
          lineItems: {
            create: [{ description: `Rental ${agreement.rentalCar.name} (${agreement.days} day${agreement.days === 1 ? '' : 's'})`, quantity: agreement.days, unitPrice: agreement.dailyRate }],
          },
        },
      });
      await tx.rentalAgreement.update({ where: { id: agreement.id }, data: { invoiceId: created.id } });
      return created;
    });
    res.status(201).json(invoice);
  }));


  // ---- PDF, e-signature and signed copies ----
  const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
  const signedUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const findAgreement = async (id: string) => {
    const row = await prisma.rentalAgreement.findUnique({ where: { id }, include: { rentalCar: true } });
    if (!row) throw new ApiError(404, 'Rental agreement not found');
    return row;
  };

  const pdfInput = (agreement: Awaited<ReturnType<typeof findAgreement>>): RentalAgreementPdfInput => ({ ...agreement, issuedOn: agreement.createdAt });

  async function storeAgreementPdf(agreementNumber: string, kind: string, bytes: Uint8Array) {
    await mkdir(uploadDirectory, { recursive: true });
    const absolute = path.join(uploadDirectory, `rental-${agreementNumber}-${kind}-${randomUUID()}.pdf`);
    await writeFile(absolute, bytes);
    return path.relative(process.cwd(), absolute);
  }

  async function readAgreementPdf(filePath: string) {
    const resolved = path.resolve(process.cwd(), filePath);
    if (path.relative(uploadDirectory, resolved).startsWith('..')) throw new ApiError(500, 'Stored agreement file is outside the upload folder');
    return readFile(resolved);
  }

  // Puts a copy on the claim's documents, when the agreement belongs to a claim.
  async function attachToClaim(claimId: string | null, agreementNumber: string, filePath: string, description: string) {
    if (!claimId) return;
    await prisma.claimDocument.create({ data: { claimId, fileName: `${agreementNumber}-rental-agreement.pdf`, filePath, documentType: 'Rental agreement', description } });
  }

  // The agreement as a PDF: the copy that was sent once sent, otherwise a fresh copy to print or sign by hand.
  router.get('/rental-agreements/:id/pdf', asyncHandler(async (req, res) => {
    const agreement = await findAgreement(idOf(req));
    const bytes = agreement.pdfFilePath
      ? await readAgreementPdf(agreement.pdfFilePath)
      : Buffer.from((await createRentalAgreementPdf(pdfInput(agreement))).pdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${agreement.agreementNumber}-rental-agreement.pdf"`);
    res.send(bytes);
  }));

  // Sends the agreement to the customer, then the shop owner after the customer signs.
  router.post('/rental-agreements/:id/send', asyncHandler(async (req, res) => {
    const agreement = await findAgreement(idOf(req));
    if (agreement.documensoEnvelopeId) throw new ApiError(409, 'This agreement was already sent for signature');
    if (agreement.status !== 'draft') throw new ApiError(409, 'Only draft agreements can be sent for signature');
    const customerEmail = agreement.customerEmail?.trim() || '';
    if (!emailPattern.test(customerEmail)) throw new ApiError(400, 'Add the customer email on the agreement before sending');

    const config = getDocumensoApiConfig();
    const shopEmail = process.env.SHOP_SIGNER_EMAIL?.trim() || SHOP.email;
    const shopName = process.env.SHOP_SIGNER_NAME?.trim() || SHOP.name;
    const generated = await createRentalAgreementPdf(pdfInput(agreement));
    const pdfFilePath = await storeAgreementPdf(agreement.agreementNumber, 'sent', generated.pdf);
    await prisma.rentalAgreement.update({ where: { id: agreement.id }, data: { pdfFilePath } });

    const envelopeId = await createRepairAuthorizationEnvelope(config, {
      authorizationId: agreement.id,
      jobId: null,
      claimId: agreement.claimId,
      jobNumber: agreement.agreementNumber,
      fileName: `${agreement.agreementNumber}-rental-agreement.pdf`,
      pdf: Buffer.from(generated.pdf),
      signerEmail: customerEmail,
      signerName: agreement.customerName,
      signers: [
        { name: agreement.customerName, email: customerEmail, signingOrder: 1, fieldPlacements: generated.fields.renter },
        { name: shopName, email: shopEmail, signingOrder: 2, fieldPlacements: generated.fields.shop },
      ],
      documentTitle: `Vehicle loan and rental agreement ${agreement.agreementNumber}`,
      emailSubject: `Please sign rental agreement ${agreement.agreementNumber}`,
      emailMessage: 'Please review, initial and sign the attached vehicle loan and rental agreement.',
    });
    await prisma.rentalAgreement.update({ where: { id: agreement.id }, data: { documensoEnvelopeId: envelopeId, documensoStatus: 'sending' } });
    await distributeDocumensoEnvelope(config, envelopeId);

    const sent = await prisma.rentalAgreement.update({
      where: { id: agreement.id },
      data: { status: 'sent', documensoStatus: 'sent', sentAt: new Date() },
      include: { rentalCar: true },
    });
    await attachToClaim(agreement.claimId, agreement.agreementNumber, pdfFilePath, 'Rental agreement sent for signature');
    res.status(201).json(sent);
  }));

  // Checks Documenso. When both signers have signed, saves the signed copy to the claim.
  router.post('/rental-agreements/:id/refresh', asyncHandler(async (req, res) => {
    const agreement = await findAgreement(idOf(req));
    if (!agreement.documensoEnvelopeId) throw new ApiError(409, 'This agreement has not been sent for signature');
    const config = getDocumensoApiConfig();
    const envelope = await getDocumensoEnvelope(config, agreement.documensoEnvelopeId);
    const completed = envelope.status.toUpperCase().includes('COMPLETE');
    if (completed && !agreement.signedFilePath) {
      const itemId = envelope.envelopeItems[0]?.id;
      if (!itemId) throw new ApiError(502, 'Documenso returned no document for this envelope');
      const signedFilePath = await storeAgreementPdf(agreement.agreementNumber, 'signed', await getSignedDocumensoDocument(config, itemId));
      await attachToClaim(agreement.claimId, agreement.agreementNumber, signedFilePath, 'Signed rental agreement');
      res.json(await prisma.rentalAgreement.update({
        where: { id: agreement.id },
        data: { status: 'signed', documensoStatus: envelope.status, signedAt: envelope.completedAt ? new Date(envelope.completedAt) : new Date(), signedFilePath },
        include: { rentalCar: true },
      }));
      return;
    }
    res.json(await prisma.rentalAgreement.update({ where: { id: agreement.id }, data: { documensoStatus: envelope.status }, include: { rentalCar: true } }));
  }));

  // Upload a copy signed by hand (wet ink) or signed outside Documenso.
  router.post('/rental-agreements/:id/signed-copy', signedUpload.single('file'), asyncHandler(async (req, res) => {
    const agreement = await findAgreement(idOf(req));
    const file = (req as { file?: { buffer: Buffer } }).file;
    if (!file) throw new ApiError(400, 'Choose the signed PDF to upload');
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ApiError(400, 'The signed copy must be a PDF');
    const signedFilePath = await storeAgreementPdf(agreement.agreementNumber, 'signed', file.buffer);
    await attachToClaim(agreement.claimId, agreement.agreementNumber, signedFilePath, 'Signed rental agreement (uploaded)');
    res.json(await prisma.rentalAgreement.update({
      where: { id: agreement.id },
      data: { status: 'signed', signedAt: new Date(), signedFilePath },
      include: { rentalCar: true },
    }));
  }));

  // The invoice as a PDF, straight from the invoice record so numbers match the Invoices page.
  router.get('/rental-agreements/:id/invoice.pdf', asyncHandler(async (req, res) => {
    const agreement = await findAgreement(idOf(req));
    if (!agreement.invoiceId) throw new ApiError(409, 'Create the invoice first');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${agreement.agreementNumber}-invoice.pdf"`);
    res.send(await invoicePdfBytes(prisma, agreement.invoiceId));
  }));

  // Insurer packet: the signed agreement (or the sent or fresh copy if not signed yet) followed by the invoice.
  router.get('/rental-agreements/:id/packet.pdf', asyncHandler(async (req, res) => {
    const agreement = await findAgreement(idOf(req));
    if (!agreement.invoiceId) throw new ApiError(409, 'Create the invoice first');
    const agreementBytes = agreement.signedFilePath
      ? await readAgreementPdf(agreement.signedFilePath)
      : agreement.pdfFilePath
        ? await readAgreementPdf(agreement.pdfFilePath)
        : Buffer.from((await createRentalAgreementPdf(pdfInput(agreement))).pdf);
    const packet = await PDFDocument.create();
    for (const bytes of [agreementBytes, await invoicePdfBytes(prisma, agreement.invoiceId)]) {
      const source = await PDFDocument.load(bytes);
      (await packet.copyPages(source, source.getPageIndices())).forEach((page) => packet.addPage(page));
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${agreement.agreementNumber}-insurer-packet.pdf"`);
    res.send(Buffer.from(await packet.save()));
  }));

  router.get('/rental-agreements/:id/signed.pdf', asyncHandler(async (req, res) => {
    const agreement = await findAgreement(idOf(req));
    if (!agreement.signedFilePath) throw new ApiError(409, 'No signed copy yet');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${agreement.agreementNumber}-signed.pdf"`);
    res.send(await readAgreementPdf(agreement.signedFilePath));
  }));
  return router;
}
