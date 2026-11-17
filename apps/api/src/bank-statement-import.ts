import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ApiError } from './errors.js';

export type BankEntryType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';

export type ParsedBankTransaction = {
  entryDate: string | null;
  description: string;
  amount: number;
  type: BankEntryType;
  category: string;
  sourceReference: string;
  needsReview: boolean;
};

export type BankStatementPreview = {
  transactions: ParsedBankTransaction[];
  warnings: string[];
};

type RawTransaction = {
  entryDate: string | null;
  description: string;
  amount: number;
  type: 'income' | 'expense';
};

export async function parseBankStatement(file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<BankStatementPreview> {
  const extension = file.originalname.toLowerCase().split('.').pop();
  let parsed: { transactions: RawTransaction[]; warnings: string[] };
  if (extension === 'csv' || file.mimetype === 'text/csv') {
    parsed = parseCsv(file.buffer.toString('utf8'));
  } else if (extension === 'pdf' || file.mimetype === 'application/pdf') {
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ApiError(400, 'The uploaded file is not a valid PDF');
    parsed = await parsePdf(file.buffer);
  } else {
    throw new ApiError(400, 'Upload a bank statement as a PDF or CSV file');
  }
  if (!parsed.transactions.length) throw new ApiError(400, 'No bank transactions could be read from this statement');

  const occurrences = new Map<string, number>();
  const transactions = parsed.transactions.map((transaction) => {
    const categorized = categorizeTransaction(transaction);
    const key = [
      transaction.entryDate || '',
      transaction.type,
      transaction.amount.toFixed(2),
      transaction.description.trim().toLocaleLowerCase(),
    ].join('|');
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    const sourceReference = `bank-import:v1:${createHash('sha256').update(`${key}|${occurrence}`).digest('hex')}`;
    return { ...categorized, sourceReference };
  });
  return { transactions, warnings: parsed.warnings };
}

function parseCsv(input: string): { transactions: RawTransaction[]; warnings: string[] } {
  const rows = readCsv(input);
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return findHeader(headers, ['date', 'transactiondate', 'posteddate']) >= 0
      && findHeader(headers, ['description', 'transactiondescription', 'details', 'payee']) >= 0
      && (findHeader(headers, ['amount', 'transactionamount']) >= 0
        || findHeader(headers, ['debit', 'withdrawal', 'withdrawals']) >= 0
        || findHeader(headers, ['credit', 'deposit', 'deposits']) >= 0);
  });
  if (headerIndex < 0) throw new ApiError(400, 'CSV needs date, description, and amount columns (or debit and credit columns)');

  const headers = rows[headerIndex].map(normalizeHeader);
  const dateIndex = findHeader(headers, ['date', 'transactiondate', 'posteddate']);
  const descriptionIndex = findHeader(headers, ['description', 'transactiondescription', 'details', 'payee']);
  const amountIndex = findHeader(headers, ['amount', 'transactionamount']);
  const debitIndex = findHeader(headers, ['debit', 'withdrawal', 'withdrawals']);
  const creditIndex = findHeader(headers, ['credit', 'deposit', 'deposits']);
  const transactions: RawTransaction[] = [];
  let ignored = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some((value) => value.trim())) continue;
    const description = row[descriptionIndex]?.trim();
    const date = parseDate(row[dateIndex] || '');
    const debit = debitIndex >= 0 ? parseMoney(row[debitIndex] || '') : null;
    const credit = creditIndex >= 0 ? parseMoney(row[creditIndex] || '') : null;
    const amount = amountIndex >= 0 ? parseMoney(row[amountIndex] || '') : null;
    if (!description || !date || (amount === null && debit === null && credit === null)) {
      ignored += 1;
      continue;
    }

    if (debit !== null || credit !== null) {
      const debitAmount = Math.abs(debit || 0);
      const creditAmount = Math.abs(credit || 0);
      if (debitAmount > 0) transactions.push({ entryDate: date, description, amount: debitAmount, type: 'expense' });
      if (creditAmount > 0) transactions.push({ entryDate: date, description, amount: creditAmount, type: 'income' });
      if (debitAmount === 0 && creditAmount === 0) ignored += 1;
    } else if (amount !== null && amount !== 0) {
      transactions.push({ entryDate: date, description, amount: Math.abs(amount), type: amount < 0 ? 'expense' : 'income' });
    } else {
      ignored += 1;
    }
  }
  return { transactions, warnings: ignored ? [`${ignored} CSV row(s) were skipped because date, description, or amount was missing.`] : [] };
}

function readCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new ApiError(400, 'CSV has an unclosed quoted field');
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function findHeader(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(header));
}

function parseMoney(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const negative = clean.startsWith('-') || clean.endsWith('-') || /^\(.*\)$/.test(clean);
  const digits = clean.replace(/[^\d.]/g, '');
  if (!digits || !Number.isFinite(Number(digits))) return null;
  const amount = Math.round(Number(digits) * 100) / 100;
  return negative ? -amount : amount;
}

function parseDate(value: string, defaultYear?: number) {
  const clean = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean);
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(clean);
  if (!us) return null;
  const yearPart = us[3] ? Number(us[3]) : defaultYear;
  if (!yearPart) return null;
  const year = yearPart < 100 ? 2000 + yearPart : yearPart;
  return validIsoDate(year, Number(us[1]), Number(us[2]));
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

async function parsePdf(buffer: Buffer): Promise<{ transactions: RawTransaction[]; warnings: string[] }> {
  const document = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  try {
    if (document.numPages > 100) throw new ApiError(400, 'Bank statement PDF exceeds the 100 page import limit');
    const pages: string[][] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const baseline = Math.round(item.transform[5] / 3) * 3;
        rows.set(baseline, [...(rows.get(baseline) || []), { x: item.transform[4], text: item.str }]);
      }
      pages.push([...rows.entries()]
        .sort((left, right) => right[0] - left[0])
        .map(([, parts]) => parts.sort((left, right) => left.x - right.x).map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim()));
    }

    const allText = pages.flat().join('\n');
    const year = /Beginning balance on [A-Za-z]+ \d{1,2}, (\d{4})/i.exec(allText)?.[1];
    const defaultYear = year ? Number(year) : undefined;
    let section: 'income' | 'expense' | 'checks' | 'fees' | null = null;
    const transactions: RawTransaction[] = [];
    let ignored = 0;

    for (const lines of pages) {
      for (const line of lines) {
        if (/^Deposits and other credits\b/i.test(line)) section = 'income';
        else if (/^Withdrawals and other debits\b/i.test(line)) section = 'expense';
        else if (/^Checks\b/i.test(line)) section = 'checks';
        else if (/^Service fees\b/i.test(line)) section = 'fees';

        if (!section || /^Total\b/i.test(line) || /^Date\s+Check/i.test(line) || /^# of\b/i.test(line)) continue;
        if (section === 'checks') {
          const checkPattern = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(\d{2,8})\s+(-?\s*\$?\s*[\d,]+\.\d{2}\s*-?)/g;
          let foundCheck = false;
          for (const match of line.matchAll(checkPattern)) {
            const entryDate = parseDate(match[1], defaultYear);
            const amount = parseMoney(match[3]);
            if (!entryDate || amount === null || amount === 0) {
              ignored += 1;
              continue;
            }
            foundCheck = true;
            transactions.push({ entryDate, description: `Check #${match[2]}`, amount: Math.abs(amount), type: 'expense' });
          }
          if (/^\d{1,2}\/\d{1,2}/.test(line) && !foundCheck) ignored += 1;
          continue;
        }

        const datedLine = /^\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)$/.exec(line);
        if (!datedLine) continue;
        const amounts = [...datedLine[2].matchAll(/-?\s*\$?\s*[\d,]+\.\d{2}\s*-?/g)];
        const entryDate = parseDate(datedLine[1], defaultYear);
        const amountText = amounts.at(-1)?.[0];
        const amount = amountText === undefined ? null : parseMoney(amountText);
        if (!entryDate || amount === null || amount === 0) {
          ignored += 1;
          continue;
        }
        const description = datedLine[2].slice(0, amounts.at(-1)!.index).trim();
        if (!description) {
          ignored += 1;
          continue;
        }
        transactions.push({
          entryDate,
          description,
          amount: Math.abs(amount),
          type: section === 'income' ? 'income' : 'expense',
        });
      }
    }
    if (!defaultYear && transactions.some((transaction) => !transaction.entryDate)) {
      throw new ApiError(400, 'The statement year could not be determined; use a CSV with full transaction dates');
    }
    if (!transactions.length) throw new ApiError(400, 'This PDF contains no readable transaction text. Scanned-only statements are not supported.');
    return {
      transactions,
      warnings: ignored ? [`${ignored} statement row(s) could not be read and were not imported. Review them manually.`] : [],
    };
  } finally {
    await document.destroy();
  }
}

function categorizeTransaction(transaction: RawTransaction) {
  const text = transaction.description.toLocaleUpperCase();
  if (/ZELLE/.test(text) && (/SYED BUKHARI|PERSONAL ACCOUNT|PAY TO RENT/.test(text))) {
    return { ...transaction, type: transaction.type === 'income' ? 'transfer_in' as const : 'transfer_out' as const, category: 'Owner transfer', needsReview: false };
  }
  let category = 'Other';
  if (transaction.type === 'income') {
    category = 'Shop income';
  } else if (/MERCH(?:ANT)? FEES|MONTHLY FEE|SERVICE FEE|BANK FEE/.test(text)) {
    category = 'Bank fees';
  } else if (/FENDER BENDER|AUTO PART|PARTS|SUPPLY CO|NAPA|AUTOZONE/.test(text)) {
    category = 'Parts';
  } else if (/INSURANCE|INS PREM|LIAB & FIRE/.test(text)) {
    category = 'Insurance';
  } else if (/CON ED|ELECTRIC|GAS &|UTILITY/.test(text)) {
    category = 'Utilities';
  } else if (/PAYROLL|ADP|GUSTO/.test(text)) {
    category = 'Payroll';
  } else if (/TAX PAYMNT|TAX PAYMENT|NYS DTF/.test(text)) {
    category = 'Taxes';
  } else if (/RESTAURANT|FOOD|SEAFOOD/.test(text)) {
    category = 'Meals';
  }
  return { ...transaction, category, needsReview: category === 'Other' || category === 'Meals' };
}
