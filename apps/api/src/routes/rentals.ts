import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { nextInvoiceNumber } from './invoices.js';

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

  return router;
}
