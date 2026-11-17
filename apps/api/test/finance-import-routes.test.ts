import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { createFinanceRouter } from '../src/routes/finance.js';

type StoredEntry = { sourceReference: string | null; type: string; amount: number };

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
      findUnique: async () => ({
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
      }),
    },
  };
  return { entries, prisma: prisma as unknown as PrismaClient };
}

async function createServer(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use('/finance', createFinanceRouter(prisma));
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

test('bank import preview and save are idempotent and owner transfers affect cash, not income', async (context) => {
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
  assert.equal(firstSave.status, 201);
  assert.deepEqual(await firstSave.json(), { imported: 1, duplicates: 0 });
  assert.equal(entries[0].type, 'transfer_in');

  const duplicatePreviewResponse = await fetch(`${baseUrl}/bank-import/preview`, { method: 'POST', body: statementForm() });
  const duplicatePreview = await duplicatePreviewResponse.json() as { transactions: Array<{ duplicate: boolean }> };
  assert.equal(duplicatePreview.transactions[0].duplicate, true);
  const secondSave = await save();
  assert.deepEqual(await secondSave.json(), { imported: 0, duplicates: 1 });

  const balanceResponse = await fetch(`${baseUrl}/bank-balance`);
  assert.deepEqual(await balanceResponse.json(), { startingBalance: 100, income: 500, expenses: 0, currentBalance: 600 });
  const summaryResponse = await fetch(`${baseUrl}/summary?period=year`);
  const summary = await summaryResponse.json() as { income: number; expenses: number };
  assert.deepEqual({ income: summary.income, expenses: summary.expenses }, { income: 0, expenses: 0 });
});

test('pay-run statement endpoint returns a downloadable one-page PDF', async (context) => {
  const { prisma } = createPrisma();
  const { baseUrl, server } = await createServer(prisma);
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`${baseUrl}/payroll/runs/run-1/statement`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/pdf/);
  assert.match(response.headers.get('content-disposition') || '', /pay-statement-Jordan-Example-2026-11-17\.pdf/);
  const document = await PDFDocument.load(await response.arrayBuffer());
  assert.equal(document.getPageCount(), 1);
});
