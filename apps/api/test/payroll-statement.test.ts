import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPayrollStatementPdf } from '../src/payroll-statement.js';

test('payroll statement contains employee earnings, each withholding, net pay, and employer taxes', async () => {
  const pdf = await buildPayrollStatementPdf({
    id: 'run-1',
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
    employee: { name: 'Jordan Example', role: 'Technician' },
  });
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
    'Pay period:',
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
  await document.destroy();
});
