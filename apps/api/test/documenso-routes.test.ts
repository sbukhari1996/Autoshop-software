import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import test from 'node:test';
import { createDocumensoRouter } from '../src/routes/documenso.js';

test('protects Documenso routes without intercepting unrelated API reads', async () => {
  const prisma = new PrismaClient();
  const app = express();
  app.use('/api', createDocumensoRouter(prisma));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const health = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(health.status, 200);
    const signing = await fetch(`http://127.0.0.1:${address.port}/api/repair-authorizations/auth-test/signing`);
    assert.equal(signing.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.$disconnect();
  }
});
