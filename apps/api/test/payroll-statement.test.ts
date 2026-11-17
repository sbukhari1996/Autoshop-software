import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPayrollStatementPdf, totalPayrollAmounts } from '../src/payroll-statement.js';

const run = {
  id: 'run-1',
  employeeId: 'employee-1',
  payDate: new Date('2026-11-17T00:00:00.000Z'),
  grossPay: 1200,
  federalWithholding: 80,
  nysWithholding: 40,
  nycWithholding: 25,
  socialSecurityEmployee: 74.4,
  medicareEmployee: 17.4,
  sdiEmployee: 0.6,
  pflEmployee: 4.66,
  netPay: 957.94,
  socialSecurityEmployer: 74.4,
  medicareEmployer: 17.4,
  futaEmployer: 7.2,
  employee: { name: 'Jordan Example', role: 'Technician', ssnLast4: '1234' },
};

test('payroll statement follows pay-stub sections with current and YTD amounts on one page', async () => {
  const ytd = totalPayrollAmounts([run, run, run]);
  const pdf = await buildPayrollStatementPdf(run, ytd);
  const parsed = await PDFDocument.load(pdf);
  const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const page = await document.getPage(1);
  const text = (await page.getTextContent()).items
    .filter((item) => 'str' in item)
    .map((item) => 'str' in item ? item.str : '')
    .join(' ');

  assert.equal(parsed.getPageCount(), 1);
  for (const label of [
    'EMPLOYEE PAY STATEMENT',
    'Jordan Example',
    'PAY STUB',
    'EMPLOYEE INFORMATION',
    'PAY STUB INFORMATION',
    'Pay period start:',
    'Pay period end:',
    'employee-1',
    'XXX-XX-1234',
    'Current pay',
    'Year to date',
    'Gross pay',
    'Federal income tax',
    'New York State income tax',
    'New York City income tax',
    'Social Security',
    'Medicare',
    'NY disability insurance',
    'NY paid family leave',
    'Total deductions',
    'Take-home pay',
    'Employer-paid taxes',
    'Federal unemployment',
    'not an official tax form',
  ]) {
    assert.ok(text.includes(label), `PDF should include ${label}`);
  }
  assert.ok(text.includes('$1,200.00'));
  assert.ok(text.includes('$957.94'));
  assert.ok(text.includes('$3,600.00'));
  assert.ok(text.includes('$2,873.82'));
  assert.ok(text.includes('$726.18'));
  for (const [, amount] of Object.entries(ytd)) {
    assert.ok(text.includes(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)));
  }
  const content = await page.getTextContent();
  for (const item of content.items) {
    if ('str' in item && item.str.trim()) {
      assert.ok(item.transform[5] > 36 && item.transform[5] < 756, `Text must remain within page margins: ${item.str}`);
    }
  }
  await document.destroy();
});

test('YTD totals use recorded paycheck cents and reset with an empty year', () => {
  assert.equal(totalPayrollAmounts([run, run, run]).pflEmployee, 13.98);
  assert.ok(Object.values(totalPayrollAmounts([])).every((amount) => amount === 0));
});
