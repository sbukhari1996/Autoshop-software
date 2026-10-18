import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { signToken } from '../src/auth.js';
import { errorHandler } from '../src/errors.js';
import type { createDocuSealRouter as createDocuSealRouterType } from '../src/routes/docuseal.js';

const uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'autoshop-docuseal-route-'));
process.env.UPLOAD_DIR = uploadDirectory;
const { createDocuSealRouter } = await import('../src/routes/docuseal.js') as {
  createDocuSealRouter: typeof createDocuSealRouterType;
};

test('requires authentication for both signing status and send routes', async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://localhost:5432/autoshop_test' } } });
  const app = express();
  app.use('/api', createDocuSealRouter(prisma));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/api/repair-authorizations/auth-test`;

  try {
    const status = await fetch(`${baseUrl}/signing`);
    const send = await fetch(`${baseUrl}/send`, { method: 'POST' });
    assert.equal(status.status, 401);
    assert.deepEqual(await status.json(), { error: 'Authentication required' });
    assert.equal(send.status, 401);
    assert.deepEqual(await send.json(), { error: 'Authentication required' });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.$disconnect();
  }
});

test('validates the send-time email, confines PDF reads to uploads, and submits the stored PDF', async () => {
  const pdf = Buffer.from('%PDF-1.4 stored repair authorization');
  const pdfPath = path.join(uploadDirectory, 'authorization.pdf');
  await writeFile(pdfPath, pdf);

  const originalEnvironment = {
    DOCUSEAL_API_KEY: process.env.DOCUSEAL_API_KEY,
    DOCUSEAL_BASE_URL: process.env.DOCUSEAL_BASE_URL,
    DOCUSEAL_SIGNER_ROLE: process.env.DOCUSEAL_SIGNER_ROLE,
  };
  let receivedPayload: Record<string, unknown> | undefined;
  let receivedToken: string | null = null;
  const docusealApp = express();
  docusealApp.use(express.json());
  docusealApp.post('/api/submissions/pdf', (req, res) => {
    receivedPayload = req.body;
    receivedToken = req.header('X-Auth-Token') || null;
    res.json([{ id: 10, submission_id: 81, status: 'sent' }]);
  });
  const docusealServer = docusealApp.listen(0, '127.0.0.1');
  await once(docusealServer, 'listening');
  const docusealAddress = docusealServer.address();
  assert.ok(docusealAddress && typeof docusealAddress === 'object');
  process.env.DOCUSEAL_API_KEY = 'test-only-api-key';
  process.env.DOCUSEAL_BASE_URL = `http://127.0.0.1:${docusealAddress.port}/api`;
  process.env.DOCUSEAL_SIGNER_ROLE = 'Customer';

  const record = {
    id: 'authorization-1',
    jobId: 'job-1',
    fileName: 'authorization.pdf',
    filePath: path.relative(process.cwd(), pdfPath),
    status: 'generated',
    docusealSubmissionId: null as string | null,
    docusealSignerEmail: null as string | null,
    docusealStatus: null as string | null,
    docusealCompletedAt: null,
    docusealFields: JSON.stringify([
      { name: 'Initials', type: 'initials', required: true, x: 40, y: 100, w: 42, h: 9, page: 1 },
    ]),
    job: {
      jobNumber: 'JOB-104',
      customer: { firstName: 'Casey', lastName: 'Customer', email: 'stored@example.test' },
    },
  };
  const prisma = {
    repairAuthorization: {
      findUnique: async () => ({ ...record }),
      updateMany: async ({ where, data }: {
        where: { docusealSubmissionId?: null; docusealStatus?: string | null };
        data: Record<string, unknown>;
      }) => {
        if (where.docusealSubmissionId === null && record.docusealSubmissionId !== null) return { count: 0 };
        if (where.docusealStatus !== undefined && record.docusealStatus !== where.docusealStatus) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  app.use('/api', createDocuSealRouter(prisma));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/repair-authorizations/${record.id}/send`;
  const authorization = `Bearer ${signToken({ sub: 'staff-1', email: 'staff@example.test', role: 'owner' })}`;

  try {
    const missingRecipient = await fetch(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientName: 'Casey Customer' }),
    });
    assert.equal(missingRecipient.status, 400);

    const invalidEmail = await fetch(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientName: 'Casey Customer', recipientEmail: 'invalid recipient' }),
    });
    assert.equal(invalidEmail.status, 400);
    const blankName = await fetch(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientName: '  ', recipientEmail: 'chosen@example.test' }),
    });
    assert.equal(blankName.status, 400);
    assert.equal(receivedPayload, undefined);

    record.filePath = path.relative(process.cwd(), path.join(uploadDirectory, '..', 'outside.pdf'));
    const outsidePath = await fetch(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientName: 'Chosen Recipient', recipientEmail: 'chosen@example.test' }),
    });
    assert.equal(outsidePath.status, 400);
    assert.equal(receivedPayload, undefined);
    record.filePath = path.relative(process.cwd(), pdfPath);

    const sent = await fetch(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientName: ' Chosen Recipient ', recipientEmail: ' chosen@example.test ' }),
    });
    assert.equal(sent.status, 201);
    assert.equal(receivedToken, 'test-only-api-key');
    assert.equal(record.docusealSignerEmail, 'chosen@example.test');
    assert.equal(record.docusealSubmissionId, '81');

    const body = receivedPayload as {
      documents: Array<{ file: string; fields: Array<{ name: string; type: string; areas: Array<{ x: number; y: number }> }> }>;
      submitters: Array<{ name: string; email: string; external_id: string; metadata: Record<string, string> }>;
      send_email: boolean;
    };
    assert.equal(body.send_email, true);
    assert.equal(Buffer.from(body.documents[0].file, 'base64').toString(), pdf.toString());
    assert.deepEqual(body.documents[0].fields.map(({ name, type }) => [name, type]), [['Initials', 'initials']]);
    assert.deepEqual(body.documents[0].fields[0].areas, [{ x: 54, y: 134, w: 56, h: 12, page: 1 }]);
    assert.equal(body.submitters[0].name, 'Chosen Recipient');
    assert.equal(body.submitters[0].email, 'chosen@example.test');
    assert.equal(body.submitters[0].external_id, record.id);
    assert.equal(body.submitters[0].metadata.repair_authorization_id, record.id);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }),
      new Promise<void>((resolve, reject) => {
        docusealServer.close((error) => error ? reject(error) : resolve());
      }),
    ]);
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(uploadDirectory, { recursive: true, force: true });
  }
});
