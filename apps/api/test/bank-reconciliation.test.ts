import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankStatement, BankTransaction } from '@prisma/client';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildReconciliationReport, compatible, quarterPeriod, reviewState, type InternalRecord } from '../src/bank-reconciliation.js';
import { reconciliationCsv, reconciliationPdf } from '../src/reconciliation-packet.js';

const date = (value: string) => new Date(`${value}T00:00:00Z`);
function bank(id: string, changes: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id, accountKey: 'operating', sourceReference: `source:${id}`, entryDate: date('2026-10-10'),
    originalDate: '2026-10-10', description: 'Payment received', amount: 100, direction: 'in',
    type: 'income', category: 'Shop income', status: 'pending', matchedSource: null, reviewNote: null,
    reviewedAt: null, createdAt: date('2026-11-17'), ...changes,
  };
}
function record(key: string, changes: Partial<InternalRecord> = {}): InternalRecord {
  return { key, kind: 'Invoice payment', id: key, date: '2026-10-10', description: 'Invoice INV-101', type: 'income', amount: 100, category: 'Shop income', ...changes };
}
function statement(transactions: BankTransaction[], changes: Partial<BankStatement> = {}) {
  return {
    id: 'statement-1', accountKey: 'operating', accountName: 'Operating', fileName: 'october.csv',
    fileHash: 'hash', periodStart: date('2026-10-01'), periodEnd: date('2026-10-31'),
    openingBalance: 1000, closingBalance: 1100, warnings: [], createdAt: date('2026-11-17'),
    ...changes, transactions,
  };
}

test('matching is conservative: exact amount candidates require confirmation; amount/direction changes invalidate matches', () => {
  const row = bank('b1');
  const payment = record('invoice-payment:1');
  assert.equal(reviewState(row, [payment], new Map()).state, 'conflicting');
  assert.equal(reviewState(row, [], new Map()).state, 'unmatched');
  assert.match(reviewState(row, [payment, record('ledger:1')], new Map()).reason, /Multiple/);
  assert.equal(compatible(row, { ...payment, amount: 100.01 }), false);
  assert.equal(compatible(row, { ...payment, type: 'expense' }), false);
  const matched = { ...row, status: 'matched', matchedSource: payment.key };
  const claimed = new Map([[payment.key, row.id]]);
  assert.equal(reviewState(matched, [payment], claimed).state, 'matched');
  assert.equal(reviewState(matched, [], claimed).state, 'conflicting');
  assert.equal(reviewState(matched, [{ ...payment, amount: 101 }], claimed).state, 'conflicting');
  assert.equal(reviewState(matched, [{ ...payment, type: 'transfer_in' }], claimed).state, 'conflicting');
  assert.equal(reviewState(bank('missing-date', { entryDate: null }), [], new Map()).state, 'conflicting');
});

test('quarter totals count canonical internal records once and do not add pending bank rows or transfers to profit', () => {
  const payment = record('invoice-payment:1');
  const rows = [
    bank('matched', { status: 'matched', matchedSource: payment.key }),
    bank('pending', { amount: 700 }),
    bank('transfer', { direction: 'out', type: 'transfer_out', amount: 50, status: 'excluded', reviewNote: 'Owner draw' }),
    bank('earlier', { entryDate: date('2026-09-30') }),
    bank('later', { entryDate: date('2027-01-01') }),
    bank('missing', { entryDate: null, amount: 20 }),
  ];
  const records = [
    payment, record('expense', { type: 'expense', amount: 30 }),
    record('transfer', { type: 'transfer_in', amount: 500 }),
    record('outside', { date: '2026-09-30', amount: 900 }),
  ];
  const report = buildReconciliationReport(2026, 4, [statement(rows)], rows, records, []);
  assert.equal(report.totals.internalIncome, 100);
  assert.equal(report.totals.internalExpenses, 30);
  assert.equal(report.totals.internalNet, 70);
  assert.equal(report.totals.bankIn, 820);
  assert.equal(report.totals.bankOut, 50);
  assert.equal(report.totals.matched, 1);
  assert.equal(report.totals.excluded, 1);
  assert.equal(report.totals.unresolved, 2);
  assert.equal(report.totals.unbanked, 2);
  assert.ok(report.highlights.some((value) => value.includes('INCOMPLETE COVERAGE')));
  assert.ok(report.highlights.some((value) => value.includes('BALANCE DIFFERENCE')));
});

test('overlapping statement rows are counted once; full quarter coverage and balances are checked', () => {
  const row = bank('b1');
  const statements = [
    statement([row], { periodStart: date('2026-10-01'), periodEnd: date('2026-11-30') }),
    statement([row], { id: 'statement-2', periodStart: date('2026-11-01'), periodEnd: date('2026-12-31') }),
  ];
  const report = buildReconciliationReport(2026, 4, statements, [row], [], []);
  assert.equal(report.totals.bankIn, 100);
  assert.ok(!report.highlights.some((value) => value.includes('INCOMPLETE COVERAGE')));
  assert.ok(report.highlights.some((value) => value.includes('OVERLAPPING STATEMENTS')));
  assert.ok(report.statements.every((value) => value.balanceDifference === 0));
});

test('cross-quarter confirmed matches preserve original cash dates and highlight timing differences', () => {
  const row = bank('b1', { entryDate: date('2026-10-01'), status: 'matched', matchedSource: 'ledger:1' });
  const report = buildReconciliationReport(2026, 4, [statement([row])], [row], [record('ledger:1', { date: '2026-09-30' })], []);
  assert.equal(report.totals.internalIncome, 0);
  assert.equal(report.totals.bankIn, 100);
  assert.equal(report.totals.matched, 1);
  assert.ok(report.highlights.some((value) => value.includes('TIMING DIFFERENCES')));
  assert.throws(() => quarterPeriod(2026, 5), /quarter/);
  assert.equal(quarterPeriod(2026, 4).end.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('quarterly PDF and CSV include highlights, statements, all support rows and formula-safe cells', async () => {
  const rows = Array.from({ length: 45 }, (_, index) => bank(`bank-${index}`, { description: `Bank detail ${index}`, amount: index + 1 }));
  const records = [record('ledger:1', { description: '=UNSAFE_FORMULA("test")' }),
    record('job-payment:1', { kind: 'Job payment' })];
  const report = buildReconciliationReport(2026, 4, [statement(rows, { warnings: ['Skipped invalid row'] })], rows, records, [
    { id: 'invoice-1', invoiceNumber: 'INV-101', status: 'paid', total: 100, amountPaid: 100, balanceDue: 0, issueDate: date('2026-10-10') },
  ]);
  const csv = reconciliationCsv(report);
  assert.ok(csv.includes('BANK TRANSACTION SUPPORT'));
  assert.ok(csv.includes('Bank detail 44'));
  assert.ok(csv.includes('PARSER WARNING'));
  assert.ok(csv.includes('\'=UNSAFE_FORMULA'));
  assert.ok(csv.includes('INV-101'));
  assert.ok(report.highlights.some((value) => value.includes('POSSIBLE INTERNAL DUPLICATES')));
  const pdf = await getDocument({ data: new Uint8Array(await reconciliationPdf(report)), useSystemFonts: true }).promise;
  assert.ok(pdf.numPages > 2);
  const texts: string[] = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    texts.push((await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' '));
  }
  const allText = texts.join(' ');
  for (const label of ['QUARTERLY RECONCILIATION PACKET', 'Bank detail 0', 'Bank detail 44', 'Internal-only exceptions', 'INV-101', 'PARSER WARNING']) {
    assert.ok(allText.includes(label), `PDF must include ${label}`);
  }
  assert.ok(texts.every((text) => /Page \d+ of/.test(text)), 'Every PDF page has a page number');
  await pdf.destroy();
});
