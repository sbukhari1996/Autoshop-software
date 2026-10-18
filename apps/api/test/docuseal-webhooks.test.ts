import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import type { createDocuSealWebhookRouter as createRouterType } from '../src/routes/docuseal-webhooks.js';

const uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'autoshop-docuseal-webhook-'));
process.env.UPLOAD_DIR = uploadDirectory;
const { createDocuSealWebhookRouter } = await import('../src/routes/docuseal-webhooks.js') as {
  createDocuSealWebhookRouter: typeof createRouterType;
};

test('imports completed PDFs when the webhook identifies authorization by external_id or metadata', async () => {
  const secret = 'test-only-webhook-secret';
  const signedPdf = Buffer.from('%PDF-1.4 signed authorization');
  const originalEnvironment = {
    DOCUSEAL_API_KEY: process.env.DOCUSEAL_API_KEY,
    DOCUSEAL_BASE_URL: process.env.DOCUSEAL_BASE_URL,
    DOCUSEAL_WEBHOOK_SECRET: process.env.DOCUSEAL_WEBHOOK_SECRET,
  };
  const docusealApp = express();
  docusealApp.get('/api/submissions/:id/documents', (_req, res) => {
    res.json({ documents: [{ name: 'signed-authorization.pdf', url: '/api/files/signed.pdf' }] });
  });
  docusealApp.get('/api/files/signed.pdf', (_req, res) => {
    res.type('application/pdf').send(signedPdf);
  });
  const docusealServer = docusealApp.listen(0, '127.0.0.1');
  await once(docusealServer, 'listening');
  const docusealAddress = docusealServer.address();
  assert.ok(docusealAddress && typeof docusealAddress === 'object');
  process.env.DOCUSEAL_API_KEY = 'test-only-api-key';
  process.env.DOCUSEAL_BASE_URL = `http://127.0.0.1:${docusealAddress.port}/api`;
  process.env.DOCUSEAL_WEBHOOK_SECRET = secret;

  try {
    for (const [index, matchType] of ['external_id', 'metadata', 'claim-only'].entries()) {
      const authorizationId = `authorization-${matchType}`;
      const submissionId = String(81 + index);
      const claimOnly = matchType === 'claim-only';
      const authorization = createAuthorization(authorizationId, claimOnly);
      const insertedDocuments: Array<{ filePath: string; fileName: string; documentType: string }> = [];
      const insertedClaimDocuments: Array<{ filePath: string; fileName: string; documentType: string }> = [];
      const prisma = {
        repairAuthorization: {
          findUnique: async ({ where }: { where: { id?: string; docusealSubmissionId?: string } }) => {
            if (where.docusealSubmissionId) return null;
            return where.id === authorizationId ? authorization : null;
          },
          updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            if (where.id !== authorizationId || authorization.docusealCompletedAt) return { count: 0 };
            if (authorization.docusealStatus === 'downloading') return { count: 0 };
            Object.assign(authorization, data);
            return { count: 1 };
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(authorization, data);
            return authorization;
          },
        },
        jobDocument: {
          createMany: async ({ data }: { data: typeof insertedDocuments }) => {
            insertedDocuments.push(...data);
            return { count: data.length };
          },
        },
        claimDocument: {
          createMany: async ({ data }: { data: typeof insertedClaimDocuments }) => {
            insertedClaimDocuments.push(...data);
            return { count: data.length };
          },
        },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
          jobDocument: {
            createMany: async ({ data }: { data: typeof insertedDocuments }) => {
              insertedDocuments.push(...data);
              return { count: data.length };
            },
          },
          claimDocument: {
            createMany: async ({ data }: { data: typeof insertedClaimDocuments }) => {
              insertedClaimDocuments.push(...data);
              return { count: data.length };
            },
          },
          repairAuthorization: {
            update: async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(authorization, data);
              return authorization;
            },
          },
        }),
      } as unknown as PrismaClient;

      const webhookApp = express();
      webhookApp.post('/', express.raw({ type: 'application/json' }), createDocuSealWebhookRouter(prisma));
      const webhookServer = webhookApp.listen(0, '127.0.0.1');
      await once(webhookServer, 'listening');
      const webhookAddress = webhookServer.address();
      assert.ok(webhookAddress && typeof webhookAddress === 'object');

      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const submitter = matchType === 'external_id'
          ? { external_id: authorizationId, email: 'chosen@example.test' }
          : { metadata: { repair_authorization_id: authorizationId }, email: 'chosen@example.test' };
        const body = Buffer.from(JSON.stringify({
          event_type: 'submission.completed',
          timestamp,
          data: { id: submissionId, submitters: [submitter] },
        }));
        const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
        const response = await fetch(`http://127.0.0.1:${webhookAddress.port}/`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Docuseal-Signature': `${timestamp}.${signature}`,
          },
          body,
        });

        assert.equal(response.status, 204);
        assert.equal(authorization.docusealSubmissionId, submissionId);
        assert.equal(authorization.docusealStatus, 'completed');
        assert.ok(authorization.docusealCompletedAt instanceof Date);
        assert.equal(insertedDocuments.length, claimOnly ? 0 : 1);
        assert.equal(insertedClaimDocuments.length, 1);
        assert.equal(insertedClaimDocuments[0].documentType, 'repair_authorization');
        assert.equal(
          (await readFile(path.resolve(process.cwd(), insertedClaimDocuments[0].filePath))).toString(),
          signedPdf.toString(),
        );
        if (!claimOnly) {
          assert.equal(insertedDocuments[0].documentType, 'repair_authorization');
          assert.notEqual(insertedClaimDocuments[0].filePath, insertedDocuments[0].filePath);
          assert.equal((await readFile(path.resolve(process.cwd(), insertedDocuments[0].filePath))).toString(), signedPdf.toString());
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          webhookServer.close((error) => error ? reject(error) : resolve());
        });
      }
    }
  } finally {
    await Promise.all([
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

function createAuthorization(id: string, claimOnly = false) {
  return {
    id,
    jobId: claimOnly ? null : `job-${id}`,
    claimId: claimOnly ? `claim-${id}` : null,
    job: claimOnly ? null : { claimId: `claim-${id}` },
    claim: claimOnly ? { id: `claim-${id}` } : null,
    docusealSubmissionId: null as string | null,
    docusealSignerEmail: null as string | null,
    docusealStatus: 'sent',
    docusealCompletedAt: null as Date | null,
  };
}
