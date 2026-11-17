import PDFDocument from 'pdfkit';
import { isoDay, type ReconciliationReport } from './bank-reconciliation.js';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const scalar = (value: unknown) => value === null || value === undefined ? '' : String(value);
const csvCell = (value: unknown) => {
  const text = scalar(value);
  const safe = /^[=+@\t\r-]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

function categoryTotals(report: ReconciliationReport) {
  const totals = new Map<string, number>();
  for (const record of report.internalRecords) {
    if (record.type !== 'income' && record.type !== 'expense') continue;
    const key = `${record.type} / ${record.category || 'Uncategorized'}`;
    totals.set(key, (totals.get(key) || 0) + Math.round(record.amount * 100));
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([label, amount]) => [label, amount / 100] as const);
}

export function reconciliationCsv(report: ReconciliationReport) {
  const t = report.totals;
  const rows: (readonly unknown[])[] = [
    [`QUARTERLY RECONCILIATION PACKET ${report.year} Q${report.quarter}`],
    ['Period', report.from, report.to],
    ['Generated at (UTC)', new Date().toISOString()],
    ['Review status', t.unresolved ? 'DRAFT - unresolved bank transactions' : 'Review uploaded-data coverage and internal-only records before relying on totals'],
    [],
    ['HIGHLIGHTS / EXCEPTIONS'],
    ...report.highlights.map((highlight) => [highlight]),
    [],
    ['CASH-BASIS SUMMARY', 'Amount'],
    ['Bank deposits (includes transfers/exclusions)', t.bankIn],
    ['Bank withdrawals (includes transfers/exclusions)', t.bankOut],
    ['Net bank movement', t.bankNet],
    ['Combined internal income', t.internalIncome],
    ['Combined internal expenses', t.internalExpenses],
    ['Combined internal net (not taxable profit)', t.internalNet],
    ['Unresolved bank rows', t.unresolved],
    ['Confirmed bank rows', t.matched],
    ['Excluded bank rows', t.excluded],
    ['Internal-only rows', t.unbanked],
    [],
    ['CATEGORY BREAKDOWN', 'Amount'],
    ...categoryTotals(report),
    [],
    ['BANK STATEMENT REGISTER'],
    ['Statement ID', 'Account', 'File', 'Period start', 'Period end', 'Opening', 'Closing', 'Balance difference', 'Rows', 'Parser warnings'],
    ...report.statements.map((s) => [s.id, s.accountName, s.fileName, s.periodStart, s.periodEnd, s.openingBalance, s.closingBalance, s.balanceDifference, s.transactionCount, s.warnings.join('; ')]),
    [],
    ['BANK TRANSACTION SUPPORT'],
    ['Bank ID', 'Account label', 'Date', 'Original parsed date', 'Description', 'Direction', 'Amount', 'Reviewed type', 'Category', 'Review state', 'Decision', 'Matched internal key', 'Internal date', 'Internal amount', 'Reason', 'Review note', 'Reviewed at', 'Import reference'],
    ...report.transactions.map((bank) => {
      const target = bank.candidates.find((record) => record.key === bank.matchedSource);
      return [bank.id, bank.accountKey, bank.entryDate ? isoDay(bank.entryDate) : '', bank.originalDate,
        bank.description, bank.direction, bank.amount, bank.type, bank.category, bank.state, bank.status,
        bank.matchedSource, target?.date, target?.amount, bank.reason, bank.reviewNote,
        bank.reviewedAt?.toISOString(), bank.sourceReference];
    }),
    [],
    ['COMBINED INTERNAL BOOKKEEPING SUPPORT (each canonical source counted once)'],
    ['Internal key', 'Source kind', 'Date', 'Description', 'Type', 'Category', 'Amount', 'Bank IDs'],
    ...report.internalRecords.map((record) => [record.key, record.kind, record.date, record.description, record.type, record.category, record.amount,
      report.transactions.filter((bank) => bank.state === 'matched' && bank.matchedSource === record.key).map((bank) => bank.id).join('; ')]),
    [],
    ['INTERNAL ONLY / NOT CONFIRMED AGAINST BANK'],
    ['Internal key', 'Source', 'Date', 'Description', 'Type', 'Amount'],
    ...report.unbanked.map((record) => [record.key, record.kind, record.date, record.description, record.type, record.amount]),
    [],
    ['INVOICE REGISTER (issued in quarter; payment and balance fields are current, not historical quarter-end balances)'],
    ['Invoice ID', 'Invoice number', 'Issued', 'Status', 'Invoice total', 'Paid to date', 'Balance due'],
    ...report.invoices.map((invoice) => [invoice.id, invoice.invoiceNumber, isoDay(invoice.issueDate), invoice.status, invoice.total, invoice.amountPaid, invoice.balanceDue]),
    [],
    ['PAYROLL RUN REGISTER (calculated wages/taxes; actual payroll payments are in internal cash expenses)'],
    ['Run ID', 'Employee', 'Pay date', 'Gross wages', 'Employee deductions', 'Net pay', 'Employer taxes'],
    ...report.payroll.map((run) => [run.id, run.employee.name, isoDay(run.payDate), run.grossPay,
      run.grossPay - run.netPay, run.netPay, run.socialSecurityEmployer + run.medicareEmployer + run.futaEmployer]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

export function reconciliationPdf(report: ReconciliationReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const width = doc.page.width - 80;
    let y = 40;
    const space = (height: number) => {
      if (y + height > 726) { doc.addPage(); y = 40; }
    };
    const paragraph = (value: string, bold = false, highlight = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      if (doc.heightOfString(value, { width: width - 16 }) > 620) {
        let lower = 1;
        let upper = value.length;
        while (lower < upper) {
          const middle = Math.ceil((lower + upper) / 2);
          if (doc.heightOfString(value.slice(0, middle), { width: width - 16 }) <= 620) lower = middle;
          else upper = middle - 1;
        }
        paragraph(value.slice(0, lower), bold, highlight);
        paragraph(value.slice(lower), bold, highlight);
        return;
      }
      const height = doc.heightOfString(value, { width: width - 16 }) + 14;
      space(height);
      if (highlight) doc.rect(40, y, width, height).fill('#fff2cd');
      doc.fillColor('#17212b').text(value, 48, y + 6, { width: width - 16 });
      y += height;
    };
    const section = (title: string) => {
      space(50);
      y += 12;
      doc.rect(40, y, width, 24).fill('#e8edf2');
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#17212b').text(title, 48, y + 6, { width: width - 16 });
      y += 29;
    };
    const amount = (label: string, value: number) => paragraph(`${label}: ${money(value)}`);
    doc.font('Helvetica-Bold').fontSize(17).text('Mastercraft Auto Repair & Collision', 40, y);
    y += 28;
    paragraph(`QUARTERLY RECONCILIATION PACKET - ${report.year} Q${report.quarter}`, true);
    paragraph(`${report.from} through ${report.to} | Generated ${new Date().toISOString()}`);
    paragraph('REVIEW PACKET - not a certified reconciliation or tax filing', true, true);
    section('Highlights and action items');
    report.highlights.forEach((value) => paragraph(value, false, /REQUIRED|MISSING|DIFFERENCE|WARNING|INCOMPLETE|ONLY|UNVERIFIED|OVERLAPPING/.test(value)));
    section('Combined cash-basis quarterly earnings');
    amount('Internal income (all canonical sources)', report.totals.internalIncome);
    amount('Internal expenses (actual recorded expenses/payments)', report.totals.internalExpenses);
    amount('Internal net (not taxable profit)', report.totals.internalNet);
    amount('Bank deposits including transfers/exclusions', report.totals.bankIn);
    amount('Bank withdrawals including transfers/exclusions', report.totals.bankOut);
    amount('Net bank movement', report.totals.bankNet);
    paragraph(`${report.totals.matched} confirmed | ${report.totals.unresolved} unresolved | ${report.totals.excluded} excluded | ${report.totals.unbanked} internal only`, true);
    section('Income and expense categories');
    categoryTotals(report).forEach(([label, value]) => amount(label, value));
    section('Bank statement register and balance checks');
    if (!report.statements.length) paragraph('No uploaded statements for this quarter.', true, true);
    for (const statement of report.statements) {
      paragraph(`${statement.accountName} | ${statement.fileName} | ${statement.periodStart} through ${statement.periodEnd}`, true);
      paragraph(`Statement ID: ${statement.id} | Parsed rows: ${statement.transactionCount}`);
      paragraph(`Opening: ${statement.openingBalance === null ? 'Not supplied' : money(statement.openingBalance)} | Closing: ${statement.closingBalance === null ? 'Not supplied' : money(statement.closingBalance)} | Balance difference: ${statement.balanceDifference === null ? 'UNVERIFIED' : money(statement.balanceDifference)}`,
        false, statement.balanceDifference !== 0);
    }
    section('Bank transaction detail and matching decisions');
    for (const bank of report.transactions) {
      paragraph(`${bank.entryDate ? isoDay(bank.entryDate) : 'DATE MISSING'} | ${bank.direction.toUpperCase()} ${money(bank.amount)} | ${bank.state.toUpperCase()} | ${bank.accountKey}`, true, bank.state === 'conflicting' || bank.state === 'unmatched');
      paragraph(`${bank.description}\nBank ID: ${bank.id}\nType/category: ${bank.type} / ${bank.category || 'Uncategorized'}\n${bank.reason}${bank.matchedSource ? `\nLinked internal record: ${bank.matchedSource}` : ''}${bank.reviewNote ? `\nReview note: ${bank.reviewNote}` : ''}`);
      const target = bank.candidates.find((record) => record.key === bank.matchedSource);
      if (target) paragraph(`Internal: ${target.date} | ${target.kind} | ${money(target.amount)} | ${target.description}`);
    }
    section('Combined internal bookkeeping support');
    for (const record of report.internalRecords) {
      const match = report.transactions.find((bank) => bank.matchedSource === record.key && bank.state === 'matched');
      paragraph(`${record.date} | ${record.type} ${money(record.amount)} | ${record.kind}`, true);
      paragraph(`${record.description}\nSource: ${record.key} | ${record.category || 'Uncategorized'}\n${match ? `Matched bank row: ${match.id}` : 'No in-quarter bank match (see timing differences and internal-only list).'}`);
    }
    section('Internal-only exceptions');
    for (const record of report.unbanked) paragraph(`${record.date} | ${money(record.amount)} | ${record.description}\n${record.key}`, false, true);
    if (!report.unbanked.length) paragraph('No internal-only records for this quarter.');
    section('Invoice register - issued this quarter');
    paragraph('Invoice amounts are not added to cash income; only recorded payments are counted. Paid/balance fields below are current values, not reconstructed historical quarter-end balances.');
    for (const invoice of report.invoices) paragraph(`${invoice.invoiceNumber} | ${isoDay(invoice.issueDate)} | ${invoice.status}\nTotal ${money(invoice.total)} | Paid to date ${money(invoice.amountPaid)} | Balance ${money(invoice.balanceDue)}`);
    section('Payroll runs - calculated wages and taxes');
    paragraph('These are calculated pay runs, not evidence of payment. Actual payroll payments are counted once in internal cash expenses; these runs are not subtracted again.');
    for (const run of report.payroll) paragraph(`${isoDay(run.payDate)} | ${run.employee.name}\nGross ${money(run.grossPay)} | Employee deductions ${money(run.grossPay - run.netPay)} | Net ${money(run.netPay)} | Employer taxes ${money(run.socialSecurityEmployer + run.medicareEmployer + run.futaEmployer)}`);
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index++) {
      doc.switchToPage(index);
      doc.font('Helvetica').fontSize(8).fillColor('#555555').text(
        `${report.year} Q${report.quarter} | Review packet | Page ${index + 1} of ${pages.count}`, 40, 738, { width, align: 'center', lineBreak: false },
      );
    }
    doc.end();
  });
}
