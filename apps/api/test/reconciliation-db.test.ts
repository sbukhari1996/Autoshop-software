import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createFinanceRouter } from '../src/routes/finance.js';
import { errorHandler } from '../src/errors.js';
import type { ReconciliationReport } from '../src/bank-reconciliation.js';

test('persisted bank review links internal sources, prevents duplicate cash entries and exports a quarterly packet', async (context) => {
  const url = process.env.RECONCILIATION_TEST_DATABASE_URL;
  assert.ok(url, 'Set RECONCILIATION_TEST_DATABASE_URL to an isolated, migrated PostgreSQL database');
  assert.ok(new URL(url).pathname.includes('reconciliation_test'), 'Refuse to run fixture writes outside a reconciliation_test database');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  context.after(() => prisma.$disconnect());
  const app = express();
  app.use(express.json());
  app.use('/finance', createFinanceRouter(prisma));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/finance/reconciliation`;
  const date = new Date('2026-10-10T00:00:00Z');
  const tag = `recon-${Date.now()}`;
  const customer = await prisma.customer.create({ data: { firstName: 'Test', lastName: tag } });
  const job = await prisma.job.create({ data: { customerId: customer.id, jobNumber: tag } });
  const expense = await prisma.jobExpense.create({ data: { jobId: job.id, description: 'Parts', amount: 40, expenseDate: date } });
  const ledgerExpense = await prisma.financeEntry.create({ data: {
    type: 'expense', description: 'Parts synced to ledger', amount: 40, entryDate: date, sourceReference: `job-expense:${expense.id}`,
  } });
  const invoice = await prisma.invoice.create({ data: { invoiceNumber: tag, total: 100, amountPaid: 100, status: 'paid', issueDate: date } });
  const payment = await prisma.payment.create({ data: { invoiceId: invoice.id, method: 'check', amount: 100, date } });
  const jobPayment = await prisma.jobPayment.create({ data: { jobId: job.id, amount: 70, source: 'insurance', paidDate: date } });
  const duplicateA = await prisma.financeEntry.create({ data: { type: 'expense', amount: 35, description: 'Duplicate candidate A', entryDate: date } });
  await prisma.financeEntry.create({ data: { type: 'expense', amount: 35, description: 'Duplicate candidate B', entryDate: date } });
  const input = [
    'Date,Description,Amount',
    '10/10/2026,Invoice receipt,100.00',
    '10/10/2026,Parts,-40.00',
    '10/10/2026,Insurance deposit,70.00',
    '10/10/2026,Unique office supplies,-12.34',
    '10/10/2026,Ambiguous purchase,-35.00',
    '10/10/2026,Owner funding,500.00',
    '10/10/2026,Already paid invoice repeat,100.00',
  ].join('\n');
  const form = (accountName = tag) => {
    const body = new FormData();
    body.append('file', new Blob([input], { type: 'text/csv' }), `${tag}.csv`);
    body.append('accountName', accountName);
    body.append('periodStart', '2026-10-01');
    body.append('periodEnd', '2026-10-31');
    body.append('openingBalance', '1000');
    body.append('closingBalance', '1682.66');
    return body;
  };
  const getReport = async () => {
    const response = await fetch(`${base}?year=2026&quarter=4`);
    assert.equal(response.status, 200);
    return response.json() as Promise<ReconciliationReport>;
  };
  const review = (id: string, data: object) => fetch(`${base}/transactions/${id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const countBefore = await prisma.financeEntry.count();
  const upload = await fetch(`${base}/statements`, { method: 'POST', body: form() });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json() as { id: string };
  assert.equal(await prisma.financeEntry.count(), countBefore, 'Uploading must not write ledger income or expenses');
  const duplicate = await fetch(`${base}/statements`, { method: 'POST', body: form() });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as { reused: boolean }).reused, true);
  let report = await getReport();
  const rows = report.transactions.filter((row) => row.accountKey === tag);
  assert.equal(rows.length, 7, 'Repeat uploads do not add duplicate bank rows');
  assert.equal(report.internalRecords.filter((row) => row.key === `job-expense:${expense.id}`).length, 0, 'Synced job expense is not counted twice');
  assert.ok(report.internalRecords.some((row) => row.key === `ledger:${ledgerExpense.id}`));
  const row = (description: string) => {
    const found = rows.find((item) => item.description === description);
    assert.ok(found, `Missing test bank row ${description}`);
    return found;
  };
  for (const [description, targetKey] of [
    ['Invoice receipt', `invoice-payment:${payment.id}`],
    ['Parts', `ledger:${ledgerExpense.id}`],
    ['Insurance deposit', `job-payment:${jobPayment.id}`],
  ]) {
    const matched = await review(row(description).id, { action: 'match', targetKey });
    assert.equal(matched.status, 200, await matched.text());
  }
  assert.equal(await prisma.financeEntry.count(), countBefore, 'Matching does not create another ledger entry');
  const wrongAmount = await review(row('Unique office supplies').id, { action: 'match', targetKey: `ledger:${ledgerExpense.id}` });
  assert.equal(wrongAmount.status, 409);
  const reuse = await review(row('Already paid invoice repeat').id, { action: 'match', targetKey: `invoice-payment:${payment.id}` });
  assert.equal(reuse.status, 409, 'One internal receipt cannot clear two bank rows');
  const ambiguous = await review(row('Ambiguous purchase').id, { action: 'create', type: 'expense', category: 'Other' });
  assert.equal(ambiguous.status, 409, 'Creating despite candidate records requires an explanation');
  const matchedAmbiguous = await review(row('Ambiguous purchase').id, { action: 'match', targetKey: `ledger:${duplicateA.id}` });
  assert.equal(matchedAmbiguous.status, 200);
  const create = await review(row('Unique office supplies').id, {
    action: 'create', type: 'expense', category: 'Office supplies',
    note: 'Verified separate transaction for this test account; prior fixtures in other accounts are not the same payment.',
  });
  assert.equal(create.status, 200);
  assert.equal(await prisma.financeEntry.count(), countBefore + 1);
  const concurrentRetry = await Promise.all([
    review(row('Unique office supplies').id, { action: 'create', type: 'expense', category: 'Office supplies' }),
    review(row('Unique office supplies').id, { action: 'create', type: 'expense', category: 'Office supplies' }),
  ]);
  assert.ok(concurrentRetry.every((response) => response.status === 409));
  assert.equal(await prisma.financeEntry.count(), countBefore + 1);
  assert.equal((await review(row('Owner funding').id, { action: 'exclude' })).status, 400);
  assert.equal((await review(row('Owner funding').id, { action: 'exclude', note: 'Owner contribution; not revenue' })).status, 200);
  report = await getReport();
  assert.equal(report.statements.find((item) => item.id === uploaded.id)?.balanceDifference, 0);
  assert.equal(report.transactions.find((item) => item.id === row('Invoice receipt').id)?.state, 'matched');
  await prisma.payment.update({ where: { id: payment.id }, data: { amount: 101 } });
  report = await getReport();
  assert.equal(report.transactions.find((item) => item.id === row('Invoice receipt').id)?.state, 'conflicting', 'Changed internal amount invalidates earlier match');
  const pdf = await fetch(`${base}/packet?year=2026&quarter=4&format=pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const csv = await fetch(`${base}/packet?year=2026&quarter=4&format=csv`);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /BANK TRANSACTION SUPPORT/);
  assert.equal((await fetch(`${base}?year=2026&quarter=5`)).status, 400);
});
