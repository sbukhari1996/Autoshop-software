import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFinanceRouter } from '../src/routes/finance.js';
import { errorHandler } from '../src/errors.js';

type StoredEntry = { sourceReference: string | null; type: string; amount: number };

const payrollAmounts = {
  grossPay: 1200, federalWithholding: 80, nysWithholding: 40, nycWithholding: 25,
  socialSecurityEmployee: 74.4, medicareEmployee: 17.4, sdiEmployee: 0.6,
  pflEmployee: 4.66, netPay: 957.94, socialSecurityEmployer: 74.4,
  medicareEmployer: 17.4, futaEmployer: 7.2,
};

function createPrisma() {
  const entries: StoredEntry[] = [];
  const prisma = {
    financeEntry: {
      findMany: async (args?: { where?: { sourceReference?: { in: string[] } } }) => {
        const refs = args?.where?.sourceReference?.in;
        return refs ? entries.filter((entry) => entry.sourceReference !== null && refs.includes(entry.sourceReference)) : entries;
      },
      createMany: async ({ data }: { data: StoredEntry[] }) => {
        let count = 0;
        for (const entry of data) {
          if (entries.some((existing) => existing.sourceReference === entry.sourceReference)) continue;
          entries.push(entry);
          count += 1;
        }
        return { count };
      },
    },
    bankAccount: {
      upsert: async () => ({ startingBalance: 100 }),
    },
    payRun: {
      findMany: async ({ where }: { where: { employeeId: string; payDate: { gte: Date; lte: Date } } }) => {
        assert.equal(where.employeeId, 'employee-1');
        assert.equal(where.payDate.gte.toISOString(), '2026-01-01T00:00:00.000Z');
        assert.equal(where.payDate.lte.toISOString(), '2026-11-17T00:00:00.000Z');
        return [
          { ...payrollAmounts, employeeId: 'employee-1', payDate: new Date('2025-12-31T00:00:00.000Z') },
          { ...payrollAmounts, employeeId: 'employee-1', payDate: new Date('2026-01-01T00:00:00.000Z'), grossPay: 800, netPay: 557.94 },
          { ...payrollAmounts, employeeId: 'employee-1', payDate: new Date('2026-11-17T00:00:00.000Z') },
          { ...payrollAmounts, employeeId: 'employee-1', payDate: new Date('2026-11-24T00:00:00.000Z') },
          { ...payrollAmounts, employeeId: 'employee-2', payDate: new Date('2026-11-17T00:00:00.000Z') },
        ].filter((run) => run.employeeId === where.employeeId && run.payDate >= where.payDate.gte && run.payDate <= where.payDate.lte);
      },
      findUnique: async () => ({
        id: 'run-1',
        employeeId: 'employee-1',
        payDate: new Date('2026-11-17T00:00:00.000Z'),
        ...payrollAmounts,
        employee: { name: 'Jordan Example', role: 'Technician', ssnLast4: '1234' },
      }),
    },
  };
  return { entries, prisma: prisma as unknown as PrismaClient };
}

async function createServer(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use('/finance', createFinanceRouter(prisma));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}/finance`, server };
}

function statementForm() {
  const form = new FormData();
  form.append('file', new Blob([
    'Date,Description,Amount\n10/02/2026,"Zelle payment from SYED BUKHARI personal account pay to rent",500.00',
  ], { type: 'text/csv' }), 'statement.csv');
  return form;
}

test('legacy bank preview identifies owner transfers but unsafe direct import is retired', async (context) => {
  const { entries, prisma } = createPrisma();
  const { baseUrl, server } = await createServer(prisma);
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const previewResponse = await fetch(`${baseUrl}/bank-import/preview`, { method: 'POST', body: statementForm() });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as { transactions: Array<{ sourceReference: string; type: string; duplicate: boolean }> };
  assert.equal(preview.transactions.length, 1);
  assert.equal(preview.transactions[0].type, 'transfer_in');
  assert.equal(preview.transactions[0].duplicate, false);

  const save = () => fetch(`${baseUrl}/bank-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: preview.transactions }),
  });
  const firstSave = await save();
  assert.equal(firstSave.status, 409);
  assert.match((await firstSave.json() as { error: string }).error, /reconciliation/);
  assert.equal(entries.length, 0);
});

test('pay-run statement endpoint returns a downloadable one-page PDF', async (context) => {
  const { prisma } = createPrisma();
  const { baseUrl, server } = await createServer(prisma);
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`${baseUrl}/payroll/runs/run-1/statement`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/pdf/);
  assert.match(response.headers.get('content-disposition') || '', /pay-statement-Jordan-Example-2026-11-17\.pdf/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  const pdf = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const page = await pdf.getPage(1);
  const text = (await page.getTextContent()).items
    .map((item) => 'str' in item ? item.str : '').join(' ');
  assert.ok(text.includes('$2,000.00'), 'YTD gross includes earlier and current paychecks');
  assert.ok(text.includes('$1,515.88'), 'YTD net uses stored net pay, not recalculated tax settings');
  await pdf.destroy();
});
