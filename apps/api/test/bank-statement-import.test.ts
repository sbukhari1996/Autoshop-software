import assert from 'node:assert/strict';
import test from 'node:test';
import PDFDocument from 'pdfkit';
import { PDFDocument as ParsedPdf } from 'pdf-lib';
import { parseBankStatement } from '../src/bank-statement-import.js';

async function samplePdf(lines: string[]) {
  const document = new PDFDocument({ size: 'LETTER', margin: 40, compress: false });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
  for (const line of lines) document.text(line);
  document.end();
  return complete;
}

test('CSV import parses signed values, quoted descriptions, and owner transfers', async () => {
  const buffer = Buffer.from([
    'Date,Description,Amount,Running Bal.',
    '10/02/2026,"Zelle payment from SYED BUKHARI, personal account pay to rent",500.00,1500.00',
    '10/03/2026,"Fender Bender Auto Parts",-143.25,1356.75',
  ].join('\r\n'));
  const preview = await parseBankStatement({ originalname: 'statement.csv', mimetype: 'text/csv', buffer });

  assert.equal(preview.transactions.length, 2);
  assert.deepEqual(preview.transactions.map(({ type, category, amount }) => ({ type, category, amount })), [
    { type: 'transfer_in', category: 'Owner transfer', amount: 500 },
    { type: 'expense', category: 'Parts', amount: 143.25 },
  ]);
  assert.equal(preview.transactions[0].entryDate, '2026-10-02');
  assert.match(preview.transactions[0].sourceReference, /^bank-import:v1:[0-9a-f]{64}$/);
  assert.deepEqual(preview.warnings, []);
});

test('CSV import supports separate debit and credit columns and flags incomplete rows', async () => {
  const buffer = Buffer.from([
    'Posted Date,Details,Debit,Credit',
    '10/04/2026,Mobile deposit,,1000.00',
    '10/05/2026,Con Edison,80.50,',
    'not-a-date,Missing date,10.00,',
  ].join('\n'));
  const preview = await parseBankStatement({ originalname: 'statement.csv', mimetype: 'text/csv', buffer });

  assert.deepEqual(preview.transactions.map(({ type, category, amount }) => ({ type, category, amount })), [
    { type: 'income', category: 'Shop income', amount: 1000 },
    { type: 'expense', category: 'Utilities', amount: 80.5 },
  ]);
  assert.equal(preview.warnings.length, 1);
});

test('PDF import reads statement sections and check rows while excluding owner transfers from income', async () => {
  const buffer = await samplePdf([
    'Beginning balance on October 1, 2026',
    'Deposits and other credits',
    '10/03/26 Zelle payment from SYED BUKHARI personal account pay to rent $500.00',
    '10/04/26 LQ MERCHANT DES:DEPOSIT ID:123 INDN:MASTERCRAFT AUTO REPAI CO $85.20',
    'Withdrawals and other debits',
    '10/05/26 CHECKCARD FENDER BENDER AUTO PART $27.00',
    'Checks',
    'Date Check # Amount',
    '10/06/26 1234 -$250.00',
    'Service fees',
    '10/31/26 Monthly Fee Business Adv Relationship -$16.00',
  ]);
  const preview = await parseBankStatement({ originalname: 'statement.pdf', mimetype: 'application/pdf', buffer });

  assert.deepEqual(preview.transactions.map(({ entryDate, description, type, category, amount }) => ({
    entryDate, description, type, category, amount,
  })), [
    { entryDate: '2026-10-03', description: 'Zelle payment from SYED BUKHARI personal account pay to rent', type: 'transfer_in', category: 'Owner transfer', amount: 500 },
    { entryDate: '2026-10-04', description: 'LQ MERCHANT DES:DEPOSIT ID:123 INDN:MASTERCRAFT AUTO REPAI CO', type: 'income', category: 'Shop income', amount: 85.2 },
    { entryDate: '2026-10-05', description: 'CHECKCARD FENDER BENDER AUTO PART', type: 'expense', category: 'Parts', amount: 27 },
    { entryDate: '2026-10-06', description: 'Check #1234', type: 'expense', category: 'Other', amount: 250 },
    { entryDate: '2026-10-31', description: 'Monthly Fee Business Adv Relationship', type: 'expense', category: 'Bank fees', amount: 16 },
  ]);
});

test('identical transactions in one statement receive distinct idempotency keys', async () => {
  const buffer = Buffer.from([
    'Date,Description,Amount',
    '10/02/2026,Mobile deposit,100.00',
    '10/02/2026,Mobile deposit,100.00',
  ].join('\n'));
  const preview = await parseBankStatement({ originalname: 'statement.csv', mimetype: 'text/csv', buffer });

  assert.equal(preview.transactions[0].sourceReference === preview.transactions[1].sourceReference, false);
});
