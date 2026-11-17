import type { BankStatement, BankTransaction, Prisma } from '@prisma/client';
import { ApiError } from './errors.js';

export type InternalRecord = {
  key: string;
  kind: string;
  id: string;
  date: string;
  description: string;
  type: string;
  amount: number;
  category: string | null;
  sourceReference?: string | null;
};
export const cents = (amount: number) => Math.round(amount * 100);
export const isInflow = (type: string) => type === 'income' || type === 'transfer_in';
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayMs = 86_400_000;

export function quarterPeriod(year: number, quarter: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new ApiError(400, 'Choose a year from 2000 to 2200 and a quarter from 1 to 4');
  }
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 1));
  return { start, end };
}

// Only known provenance links are collapsed. Similar amounts/descriptions require human review.
export async function loadInternalRecords(db: Prisma.TransactionClient): Promise<InternalRecord[]> {
  const [ledger, invoicePayments, jobPayments, expenses, payroll, rent, recurring] = await Promise.all([
    db.financeEntry.findMany(),
    db.payment.findMany({ include: { invoice: { select: { invoiceNumber: true } } } }),
    db.jobPayment.findMany({ include: { job: { select: { jobNumber: true } } } }),
    db.jobExpense.findMany({ include: { job: { select: { jobNumber: true } } } }),
    db.payrollPayment.findMany({ include: { employee: { select: { name: true } } } }),
    db.rentalPayment.findMany({ include: { tenant: { select: { name: true } } } }),
    db.recurringExpensePayment.findMany({ include: { recurringExpense: { select: { name: true, category: true } } } }),
  ]);
  const records: InternalRecord[] = ledger.map((entry) => ({
    key: `ledger:${entry.id}`, kind: 'Ledger', id: entry.id, date: isoDay(entry.entryDate),
    description: entry.description, type: entry.type, amount: entry.amount,
    category: entry.category, sourceReference: entry.sourceReference,
  }));
  const ledgerSources = new Set(ledger.map((entry) => entry.sourceReference));
  for (const payment of invoicePayments) records.push({
    key: `invoice-payment:${payment.id}`, kind: 'Invoice payment', id: payment.id, date: isoDay(payment.date),
    description: `Invoice ${payment.invoice.invoiceNumber} - ${payment.method}${payment.notes ? ` - ${payment.notes}` : ''}`,
    type: 'income', amount: payment.amount, category: 'Shop income',
  });
  for (const payment of jobPayments) records.push({
    key: `job-payment:${payment.id}`, kind: 'Job payment', id: payment.id, date: isoDay(payment.paidDate),
    description: `Job ${payment.job.jobNumber} - ${payment.source}${payment.note ? ` - ${payment.note}` : ''}`,
    type: 'income', amount: payment.amount, category: 'Shop income',
  });
  for (const expense of expenses) {
    if (ledgerSources.has(`job-expense:${expense.id}`)) continue;
    records.push({
      key: `job-expense:${expense.id}`, kind: 'Job expense', id: expense.id,
      date: isoDay(expense.expenseDate ?? expense.createdAt),
      description: `${expense.description} (${expense.job.jobNumber})`, type: 'expense',
      amount: expense.amount, category: expense.category,
    });
  }
  for (const payment of payroll) records.push({
    key: `payroll-payment:${payment.id}`, kind: 'Payroll payment', id: payment.id,
    date: isoDay(payment.paymentDate), description: `Payroll - ${payment.employee.name}`,
    type: 'expense', amount: payment.amount, category: 'Payroll',
  });
  for (const payment of rent) records.push({
    key: `rental-payment:${payment.id}`, kind: 'Rental receipt', id: payment.id,
    date: isoDay(payment.paymentDate), description: `${payment.type} - ${payment.tenant.name}`,
    type: 'income', amount: payment.amount, category: 'Rental income',
  });
  for (const payment of recurring) records.push({
    key: `recurring-payment:${payment.id}`, kind: 'Recurring expense payment', id: payment.id,
    date: isoDay(payment.paidAt), description: `${payment.recurringExpense.name} (${payment.period})`,
    type: 'expense', amount: payment.amount, category: payment.recurringExpense.category,
  });
  return records.filter((record) => record.amount > 0).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export function compatible(bank: Pick<BankTransaction, 'direction' | 'amount'>, record: InternalRecord) {
  return (bank.direction === 'in') === isInflow(record.type) && cents(bank.amount) === cents(record.amount);
}

export function reviewState(bank: BankTransaction, records: InternalRecord[], claimed: Map<string, string>) {
  const nearby = records.filter((record) =>
    bank.entryDate && Math.abs(new Date(record.date).getTime() - bank.entryDate.getTime()) <= 7 * dayMs
    && (bank.direction === 'in') === isInflow(record.type));
  const exact = nearby.filter((record) => cents(record.amount) === cents(bank.amount));
  const target = records.find((record) => record.key === bank.matchedSource);
  if (bank.status === 'excluded') return { state: 'excluded' as const, reason: bank.reviewNote || 'Excluded by reviewer', candidates: [] };
  if (bank.matchedSource) {
    const valid = target && compatible(bank, target) && bank.type === target.type && claimed.get(target.key) === bank.id;
    return {
      state: valid ? 'matched' as const : 'conflicting' as const,
      reason: valid ? `Confirmed ${bank.status === 'created' ? 'bank-only entry' : 'match'}: ${target.kind}` : 'Linked record is missing, changed, or claimed elsewhere. Review again.',
      candidates: target ? [target] : [],
    };
  }
  if (!bank.entryDate) return { state: 'conflicting' as const, reason: 'Missing bank transaction date', candidates: exact };
  if (bank.status !== 'pending') return { state: 'conflicting' as const, reason: 'Saved review has no linked record', candidates: exact };
  if (exact.length) return {
    state: 'conflicting' as const,
    reason: exact.length > 1 ? 'Multiple possible matches; confirm the correct source' :
      claimed.has(exact[0].key) ? 'Possible match is already linked to another bank transaction' : 'Possible exact-amount match; confirmation required',
    candidates: exact,
  };
  const words = bank.description.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  const similar = nearby.filter((record) => words.some((word) => record.description.toLowerCase().includes(word)));
  return {
    state: similar.length ? 'conflicting' as const : 'unmatched' as const,
    reason: similar.length ? 'Similar description with a different amount; check fees, partial payments, or grouped deposits' : 'No nearby same-amount record; review before adding to bookkeeping',
    candidates: similar,
  };
}

type StatementWithTransactions = BankStatement & { transactions: BankTransaction[] };
type InvoiceSummary = { id: string; invoiceNumber: string; status: string; total: number; amountPaid: number; balanceDue: number; issueDate: Date };
type PayrollSummary = {
  id: string; payDate: Date; grossPay: number; netPay: number;
  socialSecurityEmployer: number; medicareEmployer: number; futaEmployer: number;
  employee: { name: string };
};

export function buildReconciliationReport(
  year: number, quarter: number, statements: StatementWithTransactions[], banks: BankTransaction[],
  records: InternalRecord[], invoices: InvoiceSummary[], payroll: PayrollSummary[] = [],
) {
  const { start, end } = quarterPeriod(year, quarter);
  const from = isoDay(start);
  const to = isoDay(new Date(end.getTime() - dayMs));
  const inPeriod = (value: string) => value >= from && value <= to;
  const claimed = new Map(banks.filter((bank) => bank.matchedSource).map((bank) => [bank.matchedSource!, bank.id]));
  const relevantStatements = statements.filter((statement) => statement.periodStart < end && statement.periodEnd >= start);
  const statementBankIds = new Set(relevantStatements.flatMap((statement) => statement.transactions.map((transaction) => transaction.id)));
  const transactions = banks.filter((bank) => bank.entryDate ? inPeriod(isoDay(bank.entryDate)) : statementBankIds.has(bank.id))
    .map((bank) => ({ ...bank, ...reviewState(bank, records, claimed) }));
  const internalRecords = records.filter((record) => inPeriod(record.date));
  const validLinks = new Set(banks.filter((bank) => reviewState(bank, records, claimed).state === 'matched').map((bank) => bank.matchedSource));
  const unbanked = internalRecords.filter((record) => !validLinks.has(record.key));
  const sum = (items: { amount: number }[]) => items.reduce((total, item) => total + cents(item.amount), 0) / 100;
  const totals = {
    bankIn: sum(transactions.filter((bank) => bank.direction === 'in')),
    bankOut: sum(transactions.filter((bank) => bank.direction === 'out')),
    internalIncome: sum(internalRecords.filter((record) => record.type === 'income')),
    internalExpenses: sum(internalRecords.filter((record) => record.type === 'expense')),
    internalNet: 0, bankNet: 0,
    unresolved: transactions.filter((bank) => bank.state === 'unmatched' || bank.state === 'conflicting').length,
    matched: transactions.filter((bank) => bank.state === 'matched').length,
    excluded: transactions.filter((bank) => bank.state === 'excluded').length,
    unbanked: unbanked.length,
  };
  totals.internalNet = (cents(totals.internalIncome) - cents(totals.internalExpenses)) / 100;
  totals.bankNet = (cents(totals.bankIn) - cents(totals.bankOut)) / 100;
  const statementSummaries = relevantStatements.map((statement) => {
    const movement = statement.transactions.reduce((total, bank) => total + (bank.direction === 'in' ? 1 : -1) * cents(bank.amount), 0);
    return {
      id: statement.id, accountName: statement.accountName, fileName: statement.fileName,
      periodStart: isoDay(statement.periodStart), periodEnd: isoDay(statement.periodEnd),
      openingBalance: statement.openingBalance, closingBalance: statement.closingBalance,
      transactionCount: statement.transactions.length, warnings: statement.warnings,
      balanceDifference: statement.openingBalance === null || statement.closingBalance === null ? null :
        (cents(statement.closingBalance) - cents(statement.openingBalance) - movement) / 100,
    };
  });
  const highlights: string[] = [
    'Cash-basis reconciliation of uploaded bank data and recorded payments/expenses; not an audited statement or filed tax return.',
    'Invoice payments, job payments, ledger entries, paid recurring expenses, payroll payments and rental receipts are combined. Unpaid invoices and calculated pay runs are shown separately, not counted as cash payments.',
    'Only explicit provenance links (such as job expenses already synced to the ledger) are deduplicated. Independently entered records across modules may still duplicate the same real-world transaction; review possible duplicates before relying on totals.',
  ];
  if (!relevantStatements.length) highlights.push('MISSING BANK DATA: no statements overlap this quarter.');
  for (const account of new Set(relevantStatements.map((statement) => statement.accountKey))) {
    const ranges = relevantStatements.filter((statement) => statement.accountKey === account).sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
    let coveredUntil = start.getTime();
    let gap = false;
    for (const range of ranges) {
      if (range.periodStart.getTime() > coveredUntil) gap = true;
      coveredUntil = Math.max(coveredUntil, range.periodEnd.getTime() + dayMs);
    }
    if (gap || coveredUntil < end.getTime()) highlights.push(`INCOMPLETE COVERAGE: ${ranges[0].accountName} does not cover every date in this quarter.`);
    const overlap = ranges.some((range, index) => index > 0 && range.periodStart <= ranges[index - 1].periodEnd);
    if (overlap) highlights.push(`OVERLAPPING STATEMENTS: ${ranges[0].accountName}; identical parsed bank rows are counted once. Review any differently described duplicates.`);
  }
  for (const statement of statementSummaries) {
    if (statement.balanceDifference === null) highlights.push(`UNVERIFIED BALANCES: ${statement.accountName} / ${statement.fileName}; supply opening and closing balances.`);
    else if (statement.balanceDifference !== 0) highlights.push(`BALANCE DIFFERENCE: ${statement.accountName} / ${statement.fileName}: ${statement.balanceDifference.toFixed(2)}. Parsed movement does not equal closing minus opening balance.`);
    for (const warning of statement.warnings) highlights.push(`PARSER WARNING (${statement.fileName}): ${warning}`);
  }
  if (totals.unresolved) highlights.push(`ACTION REQUIRED: ${totals.unresolved} bank transaction(s) await review or have conflicting matches. No unresolved bank rows are automatically added to earnings.`);
  if (totals.unbanked) highlights.push(`INTERNAL ONLY: ${totals.unbanked} bookkeeping record(s) have no confirmed bank match (may include cash, outstanding checks, duplicate entries or missing statements).`);
  const duplicateCandidates = new Set<string>();
  const grouped = new Map<string, InternalRecord[]>();
  for (const record of internalRecords) {
    const key = `${isInflow(record.type) ? 'in' : 'out'}:${cents(record.amount)}`;
    const group = grouped.get(key) || [];
    for (const other of group) {
      if (record.kind !== other.kind && Math.abs(new Date(record.date).getTime() - new Date(other.date).getTime()) <= 7 * dayMs) {
        duplicateCandidates.add(record.key);
        duplicateCandidates.add(other.key);
      }
    }
    group.push(record);
    grouped.set(key, group);
  }
  if (duplicateCandidates.size) highlights.push(`POSSIBLE INTERNAL DUPLICATES: ${duplicateCandidates.size} records from different modules share an amount/direction within seven days. They remain in internal totals until corrected; check source keys in the transaction support: ${[...duplicateCandidates].join(', ')}`);
  const crossPeriod = transactions.filter((bank) => bank.state === 'matched' && bank.matchedSource &&
    records.some((record) => record.key === bank.matchedSource && !inPeriod(record.date)));
  if (crossPeriod.length) highlights.push(`TIMING DIFFERENCES: ${crossPeriod.length} bank transaction(s) match bookkeeping outside this quarter; amounts remain in their original periods.`);
  highlights.push(`QUARTER DIFFERENCE: bank net movement ${totals.bankNet.toFixed(2)} minus internal net ${totals.internalNet.toFixed(2)} = ${((cents(totals.bankNet) - cents(totals.internalNet)) / 100).toFixed(2)} before explaining transfers, exclusions, missing data and timing differences.`);
  highlights.push('Bank movement includes transfers and excluded rows; bookkeeping earnings exclude transfers. A difference between bank movement and profit is not automatically an error.');
  highlights.push('Coverage is checked only for uploaded account labels. Confirm that all business accounts and all quarter statements have been supplied.');
  return { year, quarter, from, to, highlights, totals, statements: statementSummaries, transactions, internalRecords, unbanked, invoices, payroll };
}

export type ReconciliationReport = ReturnType<typeof buildReconciliationReport>;

export async function loadReconciliationReport(db: Prisma.TransactionClient, year: number, quarter: number) {
  const { start, end } = quarterPeriod(year, quarter);
  const [statements, banks, records, invoices, payroll] = await Promise.all([
    db.bankStatement.findMany({ include: { transactions: true }, orderBy: { periodStart: 'asc' } }),
    db.bankTransaction.findMany({ orderBy: [{ entryDate: 'asc' }, { id: 'asc' }] }),
    loadInternalRecords(db),
    db.invoice.findMany({
      where: { issueDate: { gte: start, lt: end } },
      select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true, balanceDue: true, issueDate: true },
      orderBy: { invoiceNumber: 'asc' },
    }),
    db.payRun.findMany({ where: { payDate: { gte: start, lt: end } }, include: { employee: { select: { name: true } } }, orderBy: { payDate: 'asc' } }),
  ]);
  return buildReconciliationReport(year, quarter, statements, banks, records, invoices, payroll);
}
