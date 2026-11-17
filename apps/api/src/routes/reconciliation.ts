import { createHash } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalText, requiredText } from '../validation.js';
import { parseBankStatement } from '../bank-statement-import.js';
import {
  compatible, isInflow, isoDay, loadInternalRecords, loadReconciliationReport, quarterPeriod, reviewState,
} from '../bank-reconciliation.js';
import { reconciliationCsv, reconciliationPdf } from '../reconciliation-packet.js';

function day(value: unknown, field: string) {
  const text = requiredText(value, field);
  const result = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(result.getTime()) || isoDay(result) !== text) {
    throw new ApiError(400, `${field} must be a valid YYYY-MM-DD date`);
  }
  return result;
}

function balance(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e12) throw new ApiError(400, `${field} must be a valid amount`);
  return Math.round(amount * 100) / 100;
}

async function writeTransaction<T>(prisma: PrismaClient, action: (db: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      throw new ApiError(409, 'This statement or match changed during review. Refresh and retry; no partial bookkeeping changes were saved.');
    }
    throw error;
  }
}

export function createReconciliationRouter(prisma: PrismaClient, upload: RequestHandler) {
  const router = Router();
  router.post('/statements', upload, asyncHandler(async (req, res) => {
    if (!req.file?.size) throw new ApiError(400, 'Choose a non-empty PDF or CSV statement');
    const accountName = requiredText(req.body.accountName, 'accountName').trim();
    if (!accountName || accountName.length > 100) throw new ApiError(400, 'Use an account label of 1 to 100 characters');
    const accountKey = accountName.toLowerCase().replace(/\s+/g, ' ');
    const periodStart = day(req.body.periodStart, 'periodStart');
    const periodEnd = day(req.body.periodEnd, 'periodEnd');
    if (periodEnd < periodStart || periodEnd.getTime() - periodStart.getTime() > 370 * 86_400_000) {
      throw new ApiError(400, 'Statement period must be ordered and no longer than 371 days');
    }
    const openingBalance = balance(req.body.openingBalance, 'openingBalance');
    const closingBalance = balance(req.body.closingBalance, 'closingBalance');
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const fileName = req.file.originalname;
    const parsed = await parseBankStatement(req.file);
    if (parsed.transactions.length > 5000) throw new ApiError(400, 'Limit each statement to 5000 transactions');
    if (parsed.transactions.some((row) => !Number.isFinite(row.amount) || row.amount <= 0 || row.amount > 1e12)) {
      throw new ApiError(400, 'Statement transaction amounts must be greater than zero and no larger than 1 trillion');
    }
    if (parsed.transactions.some((row) => row.entryDate && (row.entryDate < isoDay(periodStart) || row.entryDate > isoDay(periodEnd)))) {
      throw new ApiError(400, 'Statement period must include every parsed transaction date. Check the dates and upload again.');
    }
    const result = await writeTransaction(prisma, async (db) => {
      const existing = await db.bankStatement.findUnique({ where: { accountKey_fileHash: { accountKey, fileHash } } });
      if (existing) return { id: existing.id, reused: true };
      const statement = await db.bankStatement.create({
        data: { accountKey, accountName, fileName, fileHash, periodStart, periodEnd, openingBalance, closingBalance, warnings: parsed.warnings },
      });
      await db.bankTransaction.createMany({
        data: parsed.transactions.map((row) => ({
            accountKey, sourceReference: row.sourceReference, originalDate: row.entryDate,
            entryDate: row.entryDate ? day(row.entryDate, 'entryDate') : null,
            description: row.description, amount: row.amount, direction: isInflow(row.type) ? 'in' : 'out',
            type: row.type, category: row.category,
        })),
        skipDuplicates: true,
      });
      const transactions = await db.bankTransaction.findMany({
        where: { accountKey, sourceReference: { in: parsed.transactions.map((row) => row.sourceReference) } },
        select: { id: true },
      });
      await db.bankStatement.update({ where: { id: statement.id }, data: { transactions: { connect: transactions } } });
      return { id: statement.id, reused: false };
    });
    res.status(result.reused ? 200 : 201).json(result);
  }));
  router.patch('/statements/:id', asyncHandler(async (req, res) => {
    const id = requiredText(req.params.id, 'id');
    const existing = await prisma.bankStatement.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Bank statement not found');
    res.json(await prisma.bankStatement.update({
      where: { id },
      data: { openingBalance: balance(req.body.openingBalance, 'openingBalance'), closingBalance: balance(req.body.closingBalance, 'closingBalance') },
    }));
  }));
  router.post('/transactions/:id/review', asyncHandler(async (req, res) => {
    const id = requiredText(req.params.id, 'id');
    const action = requiredText(req.body.action, 'action');
    if (!['match', 'create', 'exclude', 'reset'].includes(action)) throw new ApiError(400, 'Unknown reconciliation action');
    const note = optionalText(req.body.note, 'note')?.trim() || null;
    if (note && note.length > 2000) throw new ApiError(400, 'Keep review notes to 2000 characters or fewer');
    const result = await writeTransaction(prisma, async (db) => {
      const bank = await db.bankTransaction.findUnique({ where: { id }, include: { statements: true } });
      if (!bank) throw new ApiError(404, 'Bank transaction not found');
      const createdEntry = await db.financeEntry.findUnique({ where: { sourceReference: `bank-reconciliation:${bank.id}` } });
      if (createdEntry) throw new ApiError(409, 'This bank row already created a ledger entry. Edit that entry, or delete it before changing this review. A second entry will not be created.');
      if (action === 'create' && bank.matchedSource) throw new ApiError(409, 'Reset the existing match before adding a bank-only ledger entry');
      if (action === 'reset') return db.bankTransaction.update({
        where: { id }, data: { status: 'pending', matchedSource: null, reviewNote: null, reviewedAt: null },
      });
      const entryDate = req.body.entryDate ? day(req.body.entryDate, 'entryDate') : bank.entryDate;
      if (!entryDate) throw new ApiError(400, 'Supply the missing transaction date before reviewing');
      if (!bank.statements.some((statement) => entryDate >= statement.periodStart && entryDate <= statement.periodEnd)) {
        throw new ApiError(400, 'Transaction date must fall within one of its uploaded statement periods');
      }
      if (action === 'exclude') {
        if (!note) throw new ApiError(400, 'Explain why this transaction is excluded from bookkeeping');
        return db.bankTransaction.update({
          where: { id }, data: { entryDate, status: 'excluded', matchedSource: null, reviewNote: note, reviewedAt: new Date() },
        });
      }
      const records = await loadInternalRecords(db);
      if (action === 'match') {
        const targetKey = requiredText(req.body.targetKey, 'targetKey');
        const target = records.find((record) => record.key === targetKey);
        if (!target) throw new ApiError(404, 'Selected bookkeeping record no longer exists');
        if (!compatible(bank, target)) throw new ApiError(409, 'Amount and cash direction must match exactly. Resolve partial payments, fees or grouped deposits in bookkeeping before matching.');
        if (Math.abs(new Date(target.date).getTime() - entryDate.getTime()) > 7 * 86_400_000 && !note) {
          throw new ApiError(400, 'Explain the date difference when the match is more than seven days apart');
        }
        const claimed = await db.bankTransaction.findUnique({ where: { matchedSource: targetKey } });
        if (claimed && claimed.id !== id) throw new ApiError(409, 'This bookkeeping record is already matched to another bank transaction');
        return db.bankTransaction.update({
          where: { id }, data: { entryDate, type: target.type, category: target.category, status: 'matched', matchedSource: targetKey, reviewNote: note, reviewedAt: new Date() },
        });
      }
      const type = requiredText(req.body.type, 'type');
      if (!['income', 'expense', 'transfer_in', 'transfer_out'].includes(type) || isInflow(type) !== (bank.direction === 'in')) {
        throw new ApiError(400, 'Choose an income/transfer-in type for deposits, or expense/transfer-out for withdrawals');
      }
      const category = requiredText(req.body.category, 'category').trim();
      if (!category) throw new ApiError(400, 'Review and supply a category');
      const banks = await db.bankTransaction.findMany();
      const claimed = new Map(banks.filter((row) => row.matchedSource).map((row) => [row.matchedSource!, row.id]));
      const state = reviewState({ ...bank, entryDate, status: 'pending', matchedSource: null }, records, claimed);
      const legacy = records.some((record) => record.sourceReference === bank.sourceReference);
      if (legacy) throw new ApiError(409, 'This row was imported by the earlier bank importer. Match its existing ledger entry instead of creating another.');
      if (state.candidates.length && !note) throw new ApiError(409, 'Possible existing records were found. Match the correct one, or explain why this is a separate new transaction.');
      const entry = await db.financeEntry.create({
        data: { type, category, amount: bank.amount, entryDate, description: bank.description,
          sourceReference: `bank-reconciliation:${bank.id}`, notes: `Reviewed bank-only transaction${note ? `: ${note}` : ''}` },
      });
      return db.bankTransaction.update({
        where: { id }, data: { entryDate, type, category, status: 'created', matchedSource: `ledger:${entry.id}`, reviewNote: note, reviewedAt: new Date() },
      });
    });
    res.json(result);
  }));
  const report: RequestHandler = asyncHandler(async (req, res) => {
    const year = Number(req.query.year);
    const quarter = Number(req.query.quarter);
    quarterPeriod(year, quarter);
    const result = await prisma.$transaction((db) => loadReconciliationReport(db, year, quarter),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
    if (req.path === '/packet') {
      if (req.query.format === 'csv') res.type('text/csv').attachment(`quarterly-reconciliation-${year}-Q${quarter}.csv`).send(reconciliationCsv(result));
      else if (req.query.format === 'pdf') res.type('application/pdf').attachment(`quarterly-reconciliation-${year}-Q${quarter}.pdf`).send(await reconciliationPdf(result));
      else throw new ApiError(400, 'format must be pdf or csv');
    } else res.json(result);
  });
  router.get('/', report);
  router.get('/packet', report);
  return router;
}
