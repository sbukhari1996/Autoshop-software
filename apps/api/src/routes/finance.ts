import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { receiptPdf } from '../receipt-pdf.js';
import { optionalBoolean, optionalDate, optionalInteger, optionalText, requiredText } from '../validation.js';
import { defaultTaxSettings } from '../payroll-tax-defaults.js';
import { payRunAmounts } from '../payroll-calc.js';
import { buildTaxPacket } from '../tax-packet.js';
import { parseBankStatement } from '../bank-statement-import.js';
import { buildPayrollStatementPdf } from '../payroll-statement.js';

const entryTypes = ['income', 'expense', 'transfer_in', 'transfer_out'] as const;
const frequencies = ['weekly', 'monthly', 'yearly'] as const;
const paymentMethods = ['cash', 'debit_card', 'credit_card', 'check', 'ach', 'other'] as const;
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const bankStatementUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadBankStatement: RequestHandler = (req, res, next) => {
  bankStatementUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(413, 'Bank statement must be 15 MB or smaller'));
    }
    return next(error);
  });
};
type BankImportEntry = {
  type: typeof entryTypes[number];
  description: string;
  category: string | null;
  amount: number;
  entryDate: Date;
  sourceReference: string;
  notes: string;
};

async function loadTaxSettings(prisma: PrismaClient, year: number) {
  await prisma.taxSetting.createMany({ data: defaultTaxSettings(year), skipDuplicates: true });
  return Object.fromEntries((await prisma.taxSetting.findMany({ where: { year } })).map((row) => [row.key, row.value]));
}

const filingStatuses = ['single', 'married_jointly', 'head_of_household'] as const;
function payrollFields(body: Record<string, unknown>) {
  const money = (value: unknown, field: string) => {
    if (value === undefined || value === '') return undefined;
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0) throw new ApiError(400, `${field} must be zero or greater`);
    return result;
  };
  const ssnLast4 = body.ssnLast4 === undefined ? undefined : optionalText(body.ssnLast4, 'ssnLast4');
  if (ssnLast4 && !/^\d{4}$/.test(ssnLast4)) throw new ApiError(400, 'ssnLast4 must be 4 digits');
  const federalFilingStatus = body.federalFilingStatus === undefined ? undefined : optionalText(body.federalFilingStatus, 'federalFilingStatus');
  if (federalFilingStatus && !(filingStatuses as readonly string[]).includes(federalFilingStatus)) throw new ApiError(400, 'federalFilingStatus is not valid');
  return {
    ssnLast4,
    federalFilingStatus,
    w4Step2Checked: body.w4Step2Checked === undefined ? undefined : Boolean(body.w4Step2Checked),
    w4DependentsCredit: money(body.w4DependentsCredit, 'w4DependentsCredit'),
    w4OtherIncome: money(body.w4OtherIncome, 'w4OtherIncome'),
    w4Deductions: money(body.w4Deductions, 'w4Deductions'),
    w4ExtraWithholding: money(body.w4ExtraWithholding, 'w4ExtraWithholding'),
    nysAllowances: optionalInteger(body.nysAllowances, 'nysAllowances'),
    nysAdditionalWithholding: money(body.nysAdditionalWithholding, 'nysAdditionalWithholding'),
    nycResident: body.nycResident === undefined ? undefined : Boolean(body.nycResident),
  };
}

export function createFinanceRouter(prisma: PrismaClient) {
  const router = Router();
  router.get('/employees', asyncHandler(async (_req, res) => {
    res.json(await prisma.employee.findMany({ orderBy: { name: 'asc' }, include: { payments: { orderBy: { paymentDate: 'desc' } } } }));
  }));
  router.post('/employees', asyncHandler(async (req, res) => {
    const employee = await prisma.employee.create({ data: { name: requiredText(req.body.name, 'name'), phone: optionalText(req.body.phone, 'phone'), email: optionalText(req.body.email, 'email'), role: optionalText(req.body.role, 'role'), weeklyRate: req.body.weeklyRate === undefined ? undefined : nonNegativeWeeklyRate(req.body.weeklyRate), startDate: req.body.startDate ? date(req.body.startDate, 'startDate') : undefined, active: req.body.active === undefined ? undefined : Boolean(req.body.active), notes: optionalText(req.body.notes, 'notes'), ...payrollFields(req.body) }, include: { payments: true } });
    res.status(201).json(employee);
  }));
  router.patch('/employees/:id', asyncHandler(async (req, res) => {
    const employee = await prisma.employee.update({ where: { id: requiredText(req.params.id, 'id') }, data: { name: req.body.name === undefined ? undefined : requiredText(req.body.name, 'name'), phone: req.body.phone === undefined ? undefined : optionalText(req.body.phone, 'phone'), email: req.body.email === undefined ? undefined : optionalText(req.body.email, 'email'), role: req.body.role === undefined ? undefined : optionalText(req.body.role, 'role'), weeklyRate: req.body.weeklyRate === undefined ? undefined : nonNegativeWeeklyRate(req.body.weeklyRate), startDate: req.body.startDate === undefined ? undefined : date(req.body.startDate, 'startDate'), active: req.body.active === undefined ? undefined : optionalBoolean(req.body.active, 'active'), notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes'), ...payrollFields(req.body) }, include: { payments: true } });
    res.json(employee);
  }));
  router.get('/tax-settings', asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json(await prisma.taxSetting.findMany({ where: { year }, orderBy: { key: 'asc' } }).then(async (rows) => { if (rows.length) return rows; await loadTaxSettings(prisma, year); return prisma.taxSetting.findMany({ where: { year }, orderBy: { key: 'asc' } }); }));
  }));
  router.put('/tax-settings/:year/:key', asyncHandler(async (req, res) => {
    const value = Number(req.body.value);
    if (!Number.isFinite(value) || value < 0) throw new ApiError(400, 'value must be zero or greater');
    res.json(await prisma.taxSetting.update({ where: { year_key: { year: Number(req.params.year), key: requiredText(req.params.key, 'key') } }, data: { value, notes: optionalText(req.body.notes, 'notes') } }));
  }));
  router.post('/payroll/test-employees', asyncHandler(async (req, res) => {
    const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
    const count = Math.min(Math.max(Number(req.body.count) || 2, 1), 10);
    const created = [];
    for (let index = 0; index < count; index += 1) {
      created.push(await prisma.employee.create({ data: { name: `${pick(['Marcus', 'Dana', 'Luis', 'Keisha', 'Tyler', 'Priya'])} ${pick(['Reyes', 'Brooks', 'Nguyen', 'Patel', 'Owens', 'Walsh'])}`, role: 'Technician', weeklyRate: 600 + Math.round(Math.random() * 900), ssnLast4: String(1000 + Math.floor(Math.random() * 9000)), federalFilingStatus: pick(['single', 'married_jointly', 'head_of_household']), w4Step2Checked: Math.random() < 0.3, w4DependentsCredit: pick([0, 2000, 4000]), nysAllowances: Math.floor(Math.random() * 4), nycResident: true, notes: 'TEST DATA' } }));
    }
    res.status(201).json(created);
  }));
  router.post('/payroll/runs', asyncHandler(async (req, res) => {
    const payDate = date(req.body.payDate, 'payDate');
    const year = payDate.getFullYear();
    const settings = await loadTaxSettings(prisma, year);
    const yearStart = new Date(year, 0, 1);
    const employees = await prisma.employee.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    const created = [];
    for (const employee of employees) {
      if (await prisma.payRun.findFirst({ where: { employeeId: employee.id, payDate } })) continue;
      const earlier = await prisma.payRun.findMany({ where: { employeeId: employee.id, payDate: { gte: yearStart, lt: payDate } } });
      const ytdGross = earlier.reduce((total, run) => total + run.grossPay, 0);
      const amounts = payRunAmounts(employee, employee.weeklyRate, settings, { socialSecurityWages: ytdGross, futaWages: ytdGross, medicareWages: ytdGross });
      created.push(await prisma.payRun.create({ data: { employeeId: employee.id, payDate, ...amounts } }));
    }
    res.status(201).json(created);
  }));
  router.get('/payroll/runs', asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json(await prisma.payRun.findMany({ where: { payDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } }, include: { employee: { select: { name: true } } }, orderBy: [{ payDate: 'desc' }, { createdAt: 'asc' }] }));
  }));
  router.get('/payroll/runs/:id/statement', asyncHandler(async (req, res) => {
    const run = await prisma.payRun.findUnique({
      where: { id: requiredText(req.params.id, 'id') },
      include: { employee: { select: { name: true, role: true } } },
    });
    if (!run) throw new ApiError(404, 'Pay run not found');
    const pdf = await buildPayrollStatementPdf(run);
    const employeeFileName = run.employee.name.normalize('NFKD').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'employee';
    res.type('application/pdf').attachment(`pay-statement-${employeeFileName}-${run.payDate.toISOString().slice(0, 10)}.pdf`).send(pdf);
  }));
  router.post('/bank-import/preview', uploadBankStatement, asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file || !file.size) throw new ApiError(400, 'Choose a non-empty PDF or CSV bank statement');
    const preview = await parseBankStatement(file);
    const sourceReferences = preview.transactions.map((transaction) => transaction.sourceReference);
    const existing = await prisma.financeEntry.findMany({
      where: { sourceReference: { in: sourceReferences } },
      select: { sourceReference: true },
    });
    const existingReferences = new Set(existing.map((entry) => entry.sourceReference));
    res.json({
      ...preview,
      transactions: preview.transactions.map((transaction) => ({
        ...transaction,
        duplicate: existingReferences.has(transaction.sourceReference),
      })),
    });
  }));
  router.post('/bank-import', asyncHandler(async (req, res) => {
    if (!Array.isArray(req.body.transactions) || req.body.transactions.length < 1 || req.body.transactions.length > 1000) {
      throw new ApiError(400, 'transactions must contain between 1 and 1000 reviewed statement rows');
    }
    const data: BankImportEntry[] = (req.body.transactions as unknown[]).map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Each transaction must be an object');
      const transaction = value as Record<string, unknown>;
      const sourceReference = requiredText(transaction.sourceReference, 'sourceReference');
      if (!/^bank-import:v1:[0-9a-f]{64}$/.test(sourceReference)) throw new ApiError(400, 'sourceReference is not valid');
      return {
        type: validate(transaction.type, entryTypes, 'type'),
        description: requiredText(transaction.description, 'description'),
        category: optionalText(transaction.category, 'category') ?? null,
        amount: positive(transaction.amount),
        entryDate: date(transaction.entryDate, 'entryDate'),
        sourceReference,
        notes: 'Imported from a reviewed bank statement',
      };
    });
    const existing = await prisma.financeEntry.findMany({
      where: { sourceReference: { in: data.map((transaction) => transaction.sourceReference) } },
      select: { sourceReference: true },
    });
    const existingReferences = new Set(existing.map((entry) => entry.sourceReference).filter((reference): reference is string => reference !== null));
    const candidates = data.filter((transaction) => !existingReferences.has(transaction.sourceReference));
    const result = await prisma.financeEntry.createMany({ data: candidates, skipDuplicates: true });
    res.status(201).json({ imported: result.count, duplicates: data.length - result.count });
  }));
  router.get('/payroll/w2', asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const runs = await prisma.payRun.findMany({ where: { payDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } }, include: { employee: { select: { name: true } } } });
    const byEmployee = new Map<string, Record<string, number | string>>();
    for (const run of runs) {
      const fresh: Record<string, number | string> = { employeeId: run.employeeId, name: run.employee.name, runs: 0, grossWages: 0, federalWithholding: 0, nysWithholding: 0, nycWithholding: 0, socialSecurityTax: 0, medicareTax: 0, sdi: 0, pfl: 0, netPay: 0 };
      const row = byEmployee.get(run.employeeId) ?? fresh;
      const sum = (key: string, value: number) => { row[key] = Math.round(((row[key] as number) + value) * 100) / 100; };
      row.runs = (row.runs as number) + 1;
      sum('grossWages', run.grossPay); sum('federalWithholding', run.federalWithholding); sum('nysWithholding', run.nysWithholding); sum('nycWithholding', run.nycWithholding);
      sum('socialSecurityTax', run.socialSecurityEmployee); sum('medicareTax', run.medicareEmployee); sum('sdi', run.sdiEmployee); sum('pfl', run.pflEmployee); sum('netPay', run.netPay);
      byEmployee.set(run.employeeId, row);
    }
    res.json([...byEmployee.values()].sort((left, right) => String(left.name).localeCompare(String(right.name))));
  }));
  router.get('/tax-packet', asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const quarter = Number(req.query.quarter);
    if (![1, 2, 3, 4].includes(quarter)) throw new ApiError(400, 'quarter must be 1 to 4');
    const settings = await loadTaxSettings(prisma, year);
    const periodEnd = new Date(year, quarter * 3, 1);
    const yearStart = new Date(year, 0, 1);
    const quarterStart = new Date(year, (quarter - 1) * 3, 1);
    const entries = await prisma.financeEntry.findMany({ where: { entryDate: { gte: yearStart, lt: periodEnd } } });
    const runs = await prisma.payRun.findMany({ where: { payDate: { gte: yearStart, lt: periodEnd } }, include: { employee: { select: { name: true } } } });
    const rows = buildTaxPacket({ year, quarter, quarterStart, entries, runs, settings });
    const csv = rows.map((row) => row.map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replaceAll('"', '""')}"` : String(cell))).join(',')).join('\n');
    res.type('text/csv').attachment(`tax-packet-${year}-Q${quarter}.csv`).send(csv);
  }));
  router.delete('/employees/:id', asyncHandler(async (req, res) => { await prisma.employee.delete({ where: { id: requiredText(req.params.id, 'id') } }); res.status(204).send(); }));
  router.get('/payroll', asyncHandler(async (_req, res) => {
    const asOf = new Date();
    const employees = await prisma.employee.findMany({ orderBy: { name: 'asc' }, include: { payments: { orderBy: { paymentDate: 'desc' } } } });
    res.json(employees.map((employee) => {
      const elapsedMilliseconds = Math.max(0, asOf.getTime() - employee.startDate.getTime());
      const fullWeeks = Math.floor(elapsedMilliseconds / (7 * 24 * 60 * 60 * 1000));
      const expectedToDate = employee.weeklyRate * fullWeeks;
      const paidToDate = employee.payments.reduce((total, payment) => total + payment.amount, 0);
      return { ...employee, expectedToDate, paidToDate, balanceDue: expectedToDate - paidToDate };
    }));
  }));
  router.post('/employees/:employeeId/payments', asyncHandler(async (req, res) => {
    const employeeId = requiredText(req.params.employeeId, 'employeeId');
    const amount = positive(req.body.amount);
    const paymentDate = req.body.paymentDate ? date(req.body.paymentDate, 'paymentDate') : new Date();
    const payment = await prisma.$transaction(async (transaction) => {
      const employee = await transaction.employee.findUnique({ where: { id: employeeId } });
      if (!employee) throw new ApiError(404, 'Employee not found');
      const createdPayment = await transaction.payrollPayment.create({ data: { employeeId, amount, paymentDate, paymentMethod: optionalText(req.body.paymentMethod, 'paymentMethod'), notes: optionalText(req.body.notes, 'notes') } });
      return createdPayment;
    });
    res.status(201).json(payment);
  }));
  router.delete('/payments/:id', asyncHandler(async (req, res) => {
    const id = requiredText(req.params.id, 'id');
    await prisma.payrollPayment.delete({ where: { id } });
    res.status(204).send();
  }));
  router.get('/rentals', asyncHandler(async (_req, res) => {
    res.json(await prisma.rentalTenant.findMany({ orderBy: { name: 'asc' }, include: { payments: { orderBy: { paymentDate: 'desc' } } } }));
  }));
  router.get('/rentals/summary', asyncHandler(async (_req, res) => {
    const asOf = new Date();
    const tenants = await prisma.rentalTenant.findMany({ orderBy: { name: 'asc' }, include: { payments: true } });
    res.json(tenants.map((tenant) => {
      const expectedRentToDate = tenant.rentAmount * fullPeriodsElapsed(tenant.startDate, asOf, tenant.rentFrequency);
      const rentCollected = tenant.payments.filter((payment) => payment.type === 'rent').reduce((total, payment) => total + payment.amount, 0);
      const sharedExpensesCollected = tenant.payments.filter((payment) => payment.type === 'shared_expense').reduce((total, payment) => total + payment.amount, 0);
      const totalCollected = rentCollected + sharedExpensesCollected;
      return { ...tenant, expectedRentToDate, rentCollected, sharedExpensesCollected, totalCollected, netCollected: totalCollected - expectedRentToDate };
    }));
  }));
  router.post('/rentals', asyncHandler(async (req, res) => {
    const tenant = await prisma.rentalTenant.create({ data: rentalTenantData(req.body), include: { payments: true } });
    res.status(201).json(tenant);
  }));
  router.patch('/rentals/:id', asyncHandler(async (req, res) => {
    const tenant = await prisma.rentalTenant.update({ where: { id: requiredText(req.params.id, 'id') }, data: rentalTenantData(req.body, true), include: { payments: true } });
    res.json(tenant);
  }));
  router.delete('/rentals/:id', asyncHandler(async (req, res) => {
    await prisma.rentalTenant.delete({ where: { id: requiredText(req.params.id, 'id') } });
    res.status(204).send();
  }));
  router.post('/rentals/:rentalId/payments', asyncHandler(async (req, res) => {
    const tenantId = requiredText(req.params.rentalId, 'rentalId');
    const amount = positive(req.body.amount);
    const type = validate(req.body.type || 'rent', ['rent', 'shared_expense'] as const, 'type');
    const paymentDate = req.body.paymentDate ? date(req.body.paymentDate, 'paymentDate') : new Date();
    const payment = await prisma.$transaction(async (transaction) => {
      const tenant = await transaction.rentalTenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new ApiError(404, 'Rental tenant not found');
      const createdPayment = await transaction.rentalPayment.create({ data: { tenantId, type, amount, paymentDate, paymentMethod: optionalText(req.body.paymentMethod, 'paymentMethod'), notes: optionalText(req.body.notes, 'notes') } });
      return createdPayment;
    });
    res.status(201).json(payment);
  }));
  router.delete('/rental-payments/:id', asyncHandler(async (req, res) => {
    const id = requiredText(req.params.id, 'id');
    await prisma.rentalPayment.delete({ where: { id } });
    res.status(204).send();
  }));
  router.get('/entries', asyncHandler(async (req, res) => {
    const entries = await prisma.financeEntry.findMany({
      orderBy: { entryDate: 'desc' },
      include: {
        documents: { orderBy: { createdAt: 'desc' } },
        customer: { select: { firstName: true, lastName: true } },
        vehicle: { select: { year: true, make: true, model: true } },
        job: { select: { jobNumber: true } },
      },
    });
    res.json(entries);
  }));
  router.post('/entries', asyncHandler(async (req, res) => {
    const type = validate(req.body.type, entryTypes, 'type');
    const amount = positive(req.body.amount);
    const links = await entryLinks(prisma, req.body);
    const entry = await prisma.financeEntry.create({ data: { ...links, type, amount, description: requiredText(req.body.description, 'description'), category: optionalText(req.body.category, 'category'), paymentMethod: req.body.paymentMethod === undefined ? null : validate(req.body.paymentMethod, paymentMethods, 'paymentMethod'), entryDate: req.body.entryDate ? date(req.body.entryDate, 'entryDate') : new Date(), documentId: optionalText(req.body.documentId, 'documentId'), notes: optionalText(req.body.notes, 'notes') } });
    res.status(201).json(entry);
  }));
  router.patch('/entries/:id', asyncHandler(async (req, res) => {
    const id = requiredText(req.params.id, 'id');
    const existing = await prisma.financeEntry.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Ledger entry not found');
    const entry = await prisma.financeEntry.update({
      where: { id },
      data: {
        type: req.body.type === undefined ? undefined : validate(req.body.type, entryTypes, 'type'),
        amount: req.body.amount === undefined ? undefined : positive(req.body.amount),
        description: req.body.description === undefined ? undefined : requiredText(req.body.description, 'description'),
        category: req.body.category === undefined ? undefined : optionalText(req.body.category, 'category'),
        paymentMethod: req.body.paymentMethod === undefined ? undefined : validate(req.body.paymentMethod, paymentMethods, 'paymentMethod'),
        entryDate: req.body.entryDate === undefined ? undefined : date(req.body.entryDate, 'entryDate'),
        ...(['jobId', 'customerId', 'vehicleId'].some((key) => req.body[key] !== undefined) ? await entryLinks(prisma, req.body) : {}),
        claimId: null,
        notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes'),
      },
    });
    res.json(entry);
  }));
  router.delete('/entries/:id', asyncHandler(async (req, res) => {
    const id = requiredText(req.params.id, 'id');
    const entry = await prisma.financeEntry.findUnique({ where: { id }, include: { documents: true } });
    if (!entry) throw new ApiError(404, 'Ledger entry not found');
    for (const document of entry.documents) await removeStoredFile(document.filePath);
    await prisma.financeEntry.delete({ where: { id } });
    res.status(204).send();
  }));
  router.post('/entries/:id/documents', receiptUpload.single('file'), asyncHandler(async (req, res) => {
    const entryId = requiredText(req.params.id, 'id');
    const entry = await prisma.financeEntry.findUnique({ where: { id: entryId }, select: { id: true, type: true } });
    if (!entry) throw new ApiError(404, 'Ledger entry not found');
    if (entry.type !== 'expense') throw new ApiError(400, 'Receipts can only be attached to expense entries');
    const file = req.file;
    if (!file || !file.size) throw new ApiError(400, 'Choose a non-empty receipt file');
    await mkdir(uploadDirectory, { recursive: true });
    const receipt = await receiptPdf(file);
    const storedPath = path.join(uploadDirectory, `${randomUUID()}-${receipt.name}`);
    await writeFile(storedPath, receipt.bytes, { flag: 'wx' });
    try {
      const document = await prisma.financeEntryDocument.create({
        data: { entryId, fileName: receipt.name, filePath: path.relative(process.cwd(), storedPath) },
      });
      res.status(201).json(document);
    } catch (error) {
      await unlink(storedPath);
      throw error;
    }
  }));
  router.get('/entries/:id/documents/:documentId/download', asyncHandler(async (req, res) => {
    const document = await prisma.financeEntryDocument.findFirst({
      where: { id: requiredText(req.params.documentId, 'documentId'), entryId: requiredText(req.params.id, 'id') },
    });
    if (!document) throw new ApiError(404, 'Receipt not found');
    await sendStoredFile(res, document.filePath, document.fileName);
  }));
  router.delete('/entries/:id/documents/:documentId', asyncHandler(async (req, res) => {
    const entryId = requiredText(req.params.id, 'id');
    const documentId = requiredText(req.params.documentId, 'documentId');
    const document = await prisma.financeEntryDocument.findFirst({ where: { id: documentId, entryId } });
    if (!document) throw new ApiError(404, 'Receipt not found');
    await removeStoredFile(document.filePath);
    await prisma.financeEntryDocument.delete({ where: { id: documentId } });
    res.status(204).send();
  }));
  router.get('/recurring', asyncHandler(async (_req, res) => { res.json(await prisma.recurringExpense.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { payments: { orderBy: { period: 'desc' } } } })); }));
  router.post('/recurring', asyncHandler(async (req, res) => { const item = await prisma.recurringExpense.create({ data: { name: requiredText(req.body.name, 'name'), amount: positive(req.body.amount), category: optionalText(req.body.category, 'category'), frequency: validate(req.body.frequency || 'monthly', frequencies, 'frequency'), startDate: date(req.body.startDate, 'startDate'), endDate: req.body.endDate ? date(req.body.endDate, 'endDate') : undefined, active: req.body.active === undefined ? true : Boolean(req.body.active), notes: optionalText(req.body.notes, 'notes') } }); res.status(201).json(item); }));
  router.post('/recurring/:id/payments', asyncHandler(async (req, res) => {
    const recurringExpenseId = requiredText(req.params.id, 'id');
    const period = requiredText(req.body.period, 'period');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ApiError(400, 'period must be YYYY-MM');
    const recurring = await prisma.recurringExpense.findUnique({
      where: { id: recurringExpenseId },
      select: { id: true, amount: true, frequency: true, startDate: true, endDate: true, active: true },
    });
    if (!recurring) throw new ApiError(404, 'Recurring expense not found');
    if (!recurring.active) throw new ApiError(409, 'Paused recurring expenses cannot be marked paid');
    const amount = recurringAmountInMonth(recurring, period);
    if (amount <= 0) throw new ApiError(400, 'This recurring expense is not scheduled for that month');
    try {
      const payment = await prisma.recurringExpensePayment.create({
        data: { recurringExpenseId, period, amount },
      });
      res.status(201).json(payment);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'This recurring expense is already marked paid for that month');
      }
      throw error;
    }
  }));
  router.delete('/recurring/:id/payments/:paymentId', asyncHandler(async (req, res) => {
    const payment = await prisma.recurringExpensePayment.findFirst({
      where: { id: requiredText(req.params.paymentId, 'paymentId'), recurringExpenseId: requiredText(req.params.id, 'id') },
      select: { id: true },
    });
    if (!payment) throw new ApiError(404, 'Recurring expense payment not found');
    await prisma.recurringExpensePayment.delete({ where: { id: payment.id } });
    res.status(204).send();
  }));
  router.patch('/recurring/:id', asyncHandler(async (req, res) => { const item = await prisma.recurringExpense.update({ where: { id: requiredText(req.params.id, 'id') }, data: { name: req.body.name === undefined ? undefined : requiredText(req.body.name, 'name'), amount: req.body.amount === undefined ? undefined : positive(req.body.amount), frequency: req.body.frequency === undefined ? undefined : validate(req.body.frequency, frequencies, 'frequency'), category: req.body.category === undefined ? undefined : optionalText(req.body.category, 'category'), startDate: req.body.startDate === undefined ? undefined : date(req.body.startDate, 'startDate'), active: req.body.active === undefined ? undefined : Boolean(req.body.active), endDate: req.body.endDate === undefined ? undefined : (req.body.endDate ? date(req.body.endDate, 'endDate') : null), notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes') } }); res.json(item); }));
  router.delete('/recurring/:id', asyncHandler(async (req, res) => { await prisma.recurringExpense.delete({ where: { id: requiredText(req.params.id, 'id') } }); res.status(204).send(); }));
  router.get('/bank-balance', asyncHandler(async (_req, res) => {
    const account = await prisma.bankAccount.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    res.json(await calculateBankBalance(prisma, account.startingBalance));
  }));
  router.patch('/bank-balance', asyncHandler(async (req, res) => {
    const startingBalance = nonNegative(req.body.startingBalance);
    const account = await prisma.bankAccount.upsert({ where: { id: 'default' }, update: { startingBalance }, create: { id: 'default', startingBalance } });
    res.json(await calculateBankBalance(prisma, account.startingBalance));
  }));
  router.get('/summary', asyncHandler(async (req, res) => {
    const period = String(req.query.period || 'month');
    if (!['week', 'month', 'year'].includes(period)) throw new ApiError(400, 'period must be week, month, or year');
    const anchor = req.query.date ? date(req.query.date, 'date') : new Date();
    const from = startOf(anchor, period);
    const to = endOf(from, period);
    const totals = await calculatePeriodSummary(prisma, from, new Date(to.getTime() + 1));
    res.json({ period, from, to, ...totals });
  }));
  router.get('/forecast', asyncHandler(async (req, res) => { const year = Number(req.query.year || new Date().getFullYear()); if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new ApiError(400, 'year must be valid'); const from = new Date(Date.UTC(year, 0, 1)); const to = new Date(Date.UTC(year + 1, 0, 1)); const priorFrom = new Date(Date.UTC(year - 1, 0, 1)); const [current, prior, recurring] = await Promise.all([prisma.financeEntry.findMany({ where: { entryDate: { gte: from, lt: to } } }), prisma.financeEntry.findMany({ where: { entryDate: { gte: priorFrom, lt: from } } }), prisma.recurringExpense.findMany({ where: { active: true, startDate: { lt: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] } })]); const sum = (items: typeof current, type: string) => items.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0); const recurringAnnual = recurring.reduce((total, item) => total + item.amount * (item.frequency === 'weekly' ? 52 : item.frequency === 'yearly' ? 1 : 12), 0); res.json({ year, income: sum(current, 'income'), expenses: sum(current, 'expense'), priorYearIncome: sum(prior, 'income'), priorYearExpenses: sum(prior, 'expense'), recurringAnnual, projectedExpenses: sum(current, 'expense') + recurringAnnual, recurring }); }));
  router.get('/range', asyncHandler(async (req, res) => {
    const months = Math.min(12, Math.max(1, Number(req.query.months || 3)));
    if (!Number.isInteger(months)) throw new ApiError(400, 'months must be a whole number from 1 to 12');
    const anchor = req.query.date ? date(req.query.date, 'date') : new Date();
    const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - months + 1, 1));
    const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
    const totals = await calculatePeriodSummary(prisma, from, to);
    res.json({ months, from, to, ...totals });
  }));
  return router;
}
// An entry links to a job (its customer and car come with it) or to a customer and car directly.
async function entryLinks(prisma: PrismaClient, body: Record<string, unknown>) {
  if (body.jobId) {
    const job = await prisma.job.findUnique({ where: { id: String(body.jobId) }, select: { id: true, customerId: true, vehicleId: true } });
    if (!job) throw new ApiError(400, 'Job not found');
    return { jobId: job.id, customerId: job.customerId, vehicleId: job.vehicleId };
  }
  return { jobId: null, customerId: optionalText(body.customerId, 'customerId') ?? null, vehicleId: optionalText(body.vehicleId, 'vehicleId') ?? null };
}
function date(value: unknown, field: string) { const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new ApiError(400, `${field} must be a valid date`); return result; }
function positive(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new ApiError(400, 'amount must be a positive number'); return result; }
function nonNegative(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new ApiError(400, 'startingBalance must be zero or greater'); return result; }
function nonNegativeWeeklyRate(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new ApiError(400, 'weeklyRate must be zero or greater'); return result; }
async function calculatePeriodSummary(prisma: PrismaClient, from: Date, toExclusive: Date) {
  const entries = await prisma.financeEntry.findMany({ where: { entryDate: { gte: from, lt: toExclusive } } });
  const income = roundMoney(entries.filter((entry) => entry.type === 'income').reduce((total, entry) => total + entry.amount, 0));
  const expenses = roundMoney(entries.filter((entry) => entry.type === 'expense').reduce((total, entry) => total + entry.amount, 0));
  return { income, generalExpenses: expenses, jobExpenses: 0, expenses, net: roundMoney(income - expenses) };
}
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
async function sendStoredFile(res: { type: (value: string) => { send: (value: Buffer) => void } }, filePath: string, fileName: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const relativePath = path.relative(uploadDirectory, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new ApiError(400, 'Stored file path is invalid');
  try {
    await stat(resolvedPath);
    res.type(path.extname(fileName) || 'application/octet-stream').send(await readFile(resolvedPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, 'Stored file not found');
    throw error;
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
function rentalTenantData(body: Record<string, unknown>, partial: true): Prisma.RentalTenantUpdateInput;
function rentalTenantData(body: Record<string, unknown>, partial?: false): Prisma.RentalTenantCreateInput;
function rentalTenantData(body: Record<string, unknown>, partial = false): Prisma.RentalTenantCreateInput | Prisma.RentalTenantUpdateInput {
  return {
    name: body.name === undefined && partial ? undefined : requiredText(body.name, 'name'),
    phone: body.phone === undefined && partial ? undefined : optionalText(body.phone, 'phone'),
    email: body.email === undefined && partial ? undefined : optionalText(body.email, 'email'),
    space: body.space === undefined && partial ? undefined : (body.space === undefined ? 'mechanical' : requiredText(body.space, 'space')),
    shift: body.shift === undefined && partial ? undefined : validate(body.shift === undefined ? 'day' : body.shift, ['day', 'night'] as const, 'shift'),
    rentAmount: body.rentAmount === undefined && partial ? undefined : (body.rentAmount === undefined ? 0 : nonNegativeRent(body.rentAmount)),
    rentFrequency: body.rentFrequency === undefined && partial ? undefined : validate(body.rentFrequency === undefined ? 'daily' : body.rentFrequency, ['daily', 'weekly', 'monthly'] as const, 'rentFrequency'),
    startDate: body.startDate === undefined && partial ? undefined : (body.startDate ? date(body.startDate, 'startDate') : undefined),
    active: body.active === undefined && partial ? undefined : (body.active === undefined ? true : optionalBoolean(body.active, 'active')),
    notes: body.notes === undefined && partial ? undefined : optionalText(body.notes, 'notes')
  };
}
function nonNegativeRent(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new ApiError(400, 'rentAmount must be zero or greater'); return result; }
function recurringAmountInMonth(item: { amount: number; frequency: string; startDate: Date; endDate: Date | null }, period: string) {
  const [year, month] = period.split('-').map(Number);
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  const start = Date.UTC(item.startDate.getUTCFullYear(), item.startDate.getUTCMonth(), item.startDate.getUTCDate());
  const end = item.endDate
    ? Date.UTC(item.endDate.getUTCFullYear(), item.endDate.getUTCMonth(), item.endDate.getUTCDate())
    : monthEnd;
  const lowerBound = Math.max(monthStart, start);
  const upperBound = Math.min(monthEnd, end);
  if (lowerBound > upperBound) return 0;
  if (item.frequency === 'yearly') {
    if (month - 1 !== item.startDate.getUTCMonth()) return 0;
    const dueDate = Date.UTC(year, month - 1, Math.min(item.startDate.getUTCDate(), new Date(Date.UTC(year, month, 0)).getUTCDate()));
    return dueDate >= lowerBound && dueDate <= upperBound ? item.amount : 0;
  }
  if (item.frequency === 'monthly') {
    const dueDate = Date.UTC(year, month - 1, Math.min(item.startDate.getUTCDate(), new Date(Date.UTC(year, month, 0)).getUTCDate()));
    return dueDate >= lowerBound && dueDate <= upperBound ? item.amount : 0;
  }
  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  let dueDate = start;
  if (dueDate < lowerBound) dueDate += Math.ceil((lowerBound - dueDate) / (7 * dayInMilliseconds)) * 7 * dayInMilliseconds;
  let occurrences = 0;
  while (dueDate <= upperBound) {
    occurrences += 1;
    dueDate += 7 * dayInMilliseconds;
  }
  return item.amount * occurrences;
}
function validate<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] { const result = requiredText(value, field); if (!values.includes(result)) throw new ApiError(400, `${field} is invalid`); return result as T[number]; }
function fullPeriodsElapsed(startDate: Date, asOf: Date, frequency: string) {
  if (asOf < startDate) return 0;
  if (frequency === 'daily') return Math.floor((asOf.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  if (frequency === 'weekly') return Math.floor((asOf.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
  let periods = (asOf.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + asOf.getUTCMonth() - startDate.getUTCMonth();
  const anniversary = new Date(startDate);
  anniversary.setUTCMonth(startDate.getUTCMonth() + periods);
  if (anniversary > asOf) periods -= 1;
  return Math.max(0, periods);
}
async function calculateBankBalance(prisma: PrismaClient, startingBalance: number) {
  const entries = await prisma.financeEntry.findMany({ select: { type: true, amount: true } });
  const income = entries.filter((entry) => entry.type === 'income' || entry.type === 'transfer_in').reduce((total, entry) => total + entry.amount, 0);
  const expenses = entries.filter((entry) => entry.type === 'expense' || entry.type === 'transfer_out').reduce((total, entry) => total + entry.amount, 0);
  return { startingBalance, income, expenses, currentBalance: startingBalance + income - expenses };
}
function startOf(value: Date, period: string) { if (period === 'year') return new Date(Date.UTC(value.getUTCFullYear(), 0, 1)); if (period === 'week') { const day = value.getUTCDay() || 7; return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - day + 1)); } return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)); }
function endOf(start: Date, period: string) { const result = new Date(start); if (period === 'year') result.setUTCFullYear(result.getUTCFullYear() + 1); else if (period === 'week') result.setUTCDate(result.getUTCDate() + 7); else result.setUTCMonth(result.getUTCMonth() + 1); result.setUTCMilliseconds(-1); return result; }
