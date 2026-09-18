import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalText, requiredText } from '../validation.js';

const entryTypes = ['income', 'expense'] as const;
const frequencies = ['weekly', 'monthly', 'yearly'] as const;
const paymentMethods = ['cash', 'debit_card', 'credit_card', 'check', 'ach', 'other'] as const;

export function createFinanceRouter(prisma: PrismaClient) {
  const router = Router();
  router.get('/entries', asyncHandler(async (req, res) => {
    const entries = await prisma.financeEntry.findMany({ orderBy: { entryDate: 'desc' }, include: { job: { select: { jobNumber: true } }, claim: { select: { claimNumber: true } } } });
    res.json(entries);
  }));
  router.post('/entries', asyncHandler(async (req, res) => {
    const type = validate(req.body.type, entryTypes, 'type');
    const amount = positive(req.body.amount);
    const jobId = optionalText(req.body.jobId, 'jobId'); const claimId = optionalText(req.body.claimId, 'claimId');
    if (jobId && !(await prisma.job.findUnique({ where: { id: jobId } }))) throw new ApiError(404, 'Job not found');
    if (claimId && !(await prisma.claim.findUnique({ where: { id: claimId } }))) throw new ApiError(404, 'Claim not found');
    const entry = await prisma.financeEntry.create({ data: { type, amount, description: requiredText(req.body.description, 'description'), category: optionalText(req.body.category, 'category'), paymentMethod: req.body.paymentMethod === undefined ? null : validate(req.body.paymentMethod, paymentMethods, 'paymentMethod'), entryDate: req.body.entryDate ? date(req.body.entryDate, 'entryDate') : new Date(), jobId, claimId, documentId: optionalText(req.body.documentId, 'documentId'), notes: optionalText(req.body.notes, 'notes') } });
    res.status(201).json(entry);
  }));
  router.patch('/entries/:id', asyncHandler(async (req, res) => { const entry = await prisma.financeEntry.update({ where: { id: requiredText(req.params.id, 'id') }, data: { type: req.body.type === undefined ? undefined : validate(req.body.type, entryTypes, 'type'), amount: req.body.amount === undefined ? undefined : positive(req.body.amount), description: req.body.description === undefined ? undefined : requiredText(req.body.description, 'description'), category: req.body.category === undefined ? undefined : optionalText(req.body.category, 'category'), paymentMethod: req.body.paymentMethod === undefined ? undefined : validate(req.body.paymentMethod, paymentMethods, 'paymentMethod'), entryDate: req.body.entryDate === undefined ? undefined : date(req.body.entryDate, 'entryDate'), notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes') } }); res.json(entry); }));
  router.delete('/entries/:id', asyncHandler(async (req, res) => { await prisma.financeEntry.delete({ where: { id: requiredText(req.params.id, 'id') } }); res.status(204).send(); }));
  router.get('/recurring', asyncHandler(async (_req, res) => { res.json(await prisma.recurringExpense.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] })); }));
  router.post('/recurring', asyncHandler(async (req, res) => { const item = await prisma.recurringExpense.create({ data: { name: requiredText(req.body.name, 'name'), amount: positive(req.body.amount), category: optionalText(req.body.category, 'category'), frequency: validate(req.body.frequency || 'monthly', frequencies, 'frequency'), startDate: date(req.body.startDate, 'startDate'), endDate: req.body.endDate ? date(req.body.endDate, 'endDate') : undefined, active: req.body.active === undefined ? true : Boolean(req.body.active), notes: optionalText(req.body.notes, 'notes') } }); res.status(201).json(item); }));
  router.patch('/recurring/:id', asyncHandler(async (req, res) => { const item = await prisma.recurringExpense.update({ where: { id: requiredText(req.params.id, 'id') }, data: { name: req.body.name === undefined ? undefined : requiredText(req.body.name, 'name'), amount: req.body.amount === undefined ? undefined : positive(req.body.amount), frequency: req.body.frequency === undefined ? undefined : validate(req.body.frequency, frequencies, 'frequency'), category: req.body.category === undefined ? undefined : optionalText(req.body.category, 'category'), active: req.body.active === undefined ? undefined : Boolean(req.body.active), endDate: req.body.endDate === undefined ? undefined : (req.body.endDate ? date(req.body.endDate, 'endDate') : null), notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes') } }); res.json(item); }));
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
  router.get('/summary', asyncHandler(async (req, res) => { const period = String(req.query.period || 'month'); if (!['week', 'month', 'year'].includes(period)) throw new ApiError(400, 'period must be week, month, or year'); const anchor = req.query.date ? date(req.query.date, 'date') : new Date(); const from = startOf(anchor, period); const to = endOf(from, period); const [entries, jobs] = await Promise.all([prisma.financeEntry.findMany({ where: { entryDate: { gte: from, lte: to } } }), prisma.jobExpense.findMany({ where: { expenseDate: { gte: from, lte: to } } })]); const income = entries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0); const general = entries.filter((e) => e.type === 'expense' && !e.jobId).reduce((s, e) => s + e.amount, 0); const syncedExpenseIds = new Set(entries.filter((e) => e.sourceReference?.startsWith('job-expense:')).map((e) => e.sourceReference!.slice('job-expense:'.length))); const jobExpenses = jobs.filter((e) => !syncedExpenseIds.has(e.id)).reduce((s, e) => s + e.amount, 0) + entries.filter((e) => e.type === 'expense' && Boolean(e.jobId)).reduce((s, e) => s + e.amount, 0); res.json({ period, from, to, income, generalExpenses: general, jobExpenses, expenses: general + jobExpenses, net: income - general - jobExpenses }); }));
  router.get('/forecast', asyncHandler(async (req, res) => { const year = Number(req.query.year || new Date().getFullYear()); if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new ApiError(400, 'year must be valid'); const from = new Date(Date.UTC(year, 0, 1)); const to = new Date(Date.UTC(year + 1, 0, 1)); const priorFrom = new Date(Date.UTC(year - 1, 0, 1)); const [current, prior, recurring] = await Promise.all([prisma.financeEntry.findMany({ where: { entryDate: { gte: from, lt: to } } }), prisma.financeEntry.findMany({ where: { entryDate: { gte: priorFrom, lt: from } } }), prisma.recurringExpense.findMany({ where: { active: true, startDate: { lt: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] } })]); const sum = (items: typeof current, type: string) => items.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0); const recurringAnnual = recurring.reduce((total, item) => total + item.amount * (item.frequency === 'weekly' ? 52 : item.frequency === 'yearly' ? 1 : 12), 0); res.json({ year, income: sum(current, 'income'), expenses: sum(current, 'expense'), priorYearIncome: sum(prior, 'income'), priorYearExpenses: sum(prior, 'expense'), recurringAnnual, projectedExpenses: sum(current, 'expense') + recurringAnnual, recurring }); }));
  return router;
}
function date(value: unknown, field: string) { const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new ApiError(400, `${field} must be a valid date`); return result; }
function positive(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new ApiError(400, 'amount must be a positive number'); return result; }
function nonNegative(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new ApiError(400, 'startingBalance must be zero or greater'); return result; }
function validate<T extends readonly string[]>(value: unknown, values: T, field: string) { const result = requiredText(value, field); if (!values.includes(result)) throw new ApiError(400, `${field} is invalid`); return result; }
async function calculateBankBalance(prisma: PrismaClient, startingBalance: number) {
  const entries = await prisma.financeEntry.findMany({ select: { type: true, amount: true } });
  const income = entries.filter((entry) => entry.type === 'income').reduce((total, entry) => total + entry.amount, 0);
  const expenses = entries.filter((entry) => entry.type === 'expense').reduce((total, entry) => total + entry.amount, 0);
  return { startingBalance, income, expenses, currentBalance: startingBalance + income - expenses };
}
function startOf(value: Date, period: string) { if (period === 'year') return new Date(Date.UTC(value.getUTCFullYear(), 0, 1)); if (period === 'week') { const day = value.getUTCDay() || 7; return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - day + 1)); } return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)); }
function endOf(start: Date, period: string) { const result = new Date(start); if (period === 'year') result.setUTCFullYear(result.getUTCFullYear() + 1); else if (period === 'week') result.setUTCDate(result.getUTCDate() + 7); else result.setUTCMonth(result.getUTCMonth() + 1); result.setUTCMilliseconds(-1); return result; }
