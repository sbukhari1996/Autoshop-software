import assert from 'node:assert/strict';
import test from 'node:test';
import { dopAuthorizationFileName, signedAuthorizationDownloadName } from '../src/authorization-document-name.js';
import {
  buildDocumensoPayload,
  canStartAuthorizationSigning,
  createRepairAuthorizationEnvelope,
  distributeDocumensoEnvelope,
  getDocumensoApiConfig,
  getDocumensoEnvelope,
  getSignedDocumensoDocument,
  type RepairAuthorizationSubmission,
} from '../src/documenso.js';

const submission: RepairAuthorizationSubmission = {
  authorizationId: 'authorization-test',
  jobId: 'job-test',
  claimId: 'claim-test',
  jobNumber: 'JOB-104',
  fileName: 'authorization.pdf',
  pdf: Buffer.from('%PDF-1.4 test authorization'),
  signerEmail: 'customer@example.test',
  signerName: 'Casey Customer',
  fieldPlacements: [
    { name: 'Initials', type: 'initials', required: true, x: 42, y: 100, w: 35, h: 9, page: 1 },
    { name: 'Signature', type: 'signature', required: true, x: 223, y: 646, w: 173, h: 9, page: 1 },
    { name: 'Date', type: 'date', required: true, x: 407, y: 646, w: 166, h: 9, page: 1 },
    { name: 'Insurance Company', type: 'text', required: true, x: 50, y: 300, w: 150, h: 10, page: 1 },
  ],
};

const config = getDocumensoApiConfig({
  DOCUMENSO_API_TOKEN: 'api_test-token',
  DOCUMENSO_API_URL: 'http://127.0.0.1:3000/api/v2',
});

test('names signed authorizations with a safe DOP customer filename', () => {
  assert.equal(dopAuthorizationFileName('Jane Doe'), 'DOP-Jane-Doe.pdf');
  assert.equal(dopAuthorizationFileName('José O’Neil / Smith'), 'DOP-Jose-O-Neil-Smith.pdf');
  assert.equal(dopAuthorizationFileName(''), 'DOP-Customer.pdf');
  assert.equal(
    signedAuthorizationDownloadName('signed-repair-authorization-cmv1.pdf', 'repair_authorization', 'Jane Doe'),
    'DOP-Jane-Doe.pdf',
  );
  assert.equal(
    signedAuthorizationDownloadName('receipt.pdf', 'receipt', 'Jane Doe'),
    'receipt.pdf',
  );
});

test('maps the authorization PDF and fields to a Documenso signer envelope', () => {
  const payload = buildDocumensoPayload(submission);
  assert.equal(payload.type, 'DOCUMENT');
  assert.equal(payload.externalId, submission.authorizationId);
  assert.equal(payload.recipients[0].role, 'SIGNER');
  assert.equal(payload.recipients[0].email, submission.signerEmail);
  assert.equal(payload.recipients[0].fields[0].type, 'INITIALS');
  assert.equal(payload.recipients[0].fields[1].type, 'SIGNATURE');
  assert.equal(payload.recipients[0].fields[2].type, 'DATE');
  assert.equal(payload.recipients[0].fields[3].fieldMeta.label, 'Insurance Company');
  assert.equal(payload.recipients[0].fields[3].fieldMeta.required, true);
  assert.equal(payload.recipients[0].fields[1].positionX, Number(((223 / 612) * 100).toFixed(5)));
  assert.equal(payload.recipients[0].fields[1].positionY, Number(((646 / 792) * 100).toFixed(5)));
});

test('allows another signing request except while a send or signed-document save is uncertain', () => {
  for (const status of ['not_sent', 'sent', 'completed', 'cancelled', 'canceled', 'declined', 'expired', 'deleted', 'send_failed']) {
    assert.equal(canStartAuthorizationSigning(status), true, `${status} should allow a new request`);
  }
  for (const status of ['sending', 'send_unknown', 'downloading', 'download_failed']) {
    assert.equal(canStartAuthorizationSigning(status), false, `${status} should remain protected`);
  }
});

test('creates the PDF envelope and distributes it using server-side authorization', async () => {
  const requests: Array<{ url: string; method: string; authorization: string | null; contentType: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    requests.push({
      url,
      method,
      authorization: new Headers(init?.headers).get('Authorization'),
      contentType: new Headers(init?.headers).get('content-type'),
    });
    if (url.endsWith('/envelope/create')) {
      const form = init?.body as FormData;
      assert.equal(form.get('payload') && JSON.parse(String(form.get('payload'))).externalId, submission.authorizationId);
      const file = form.get('files');
      assert.ok(file instanceof Blob);
      assert.equal(await file.text(), submission.pdf.toString());
      return Response.json({ id: 'envelope_test123' });
    }
    assert.equal(url.endsWith('/envelope/distribute'), true);
    assert.deepEqual(JSON.parse(String(init?.body)), { envelopeId: 'envelope_test123' });
    return Response.json({ success: true, id: 'envelope_test123', recipients: [] });
  };

  const envelopeId = await createRepairAuthorizationEnvelope(config, submission, fetcher);
  await distributeDocumensoEnvelope(config, envelopeId, fetcher);
  assert.equal(envelopeId, 'envelope_test123');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.authorization === 'api_test-token'));
  assert.equal(requests[0].contentType, null);
  assert.equal(requests[1].contentType, 'application/json');
});

test('reads envelope status and accepts only signed PDF downloads', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/envelope/envelope_test123')) {
      return Response.json({
        id: 'envelope_test123',
        status: 'COMPLETED',
        completedAt: '2026-10-18T04:00:00.000Z',
        recipients: [{ email: submission.signerEmail }],
        envelopeItems: [{ id: 'envelope_item_test123' }],
      });
    }
    assert.match(url, /envelope\/item\/envelope_item_test123\/download\?version=signed$/);
    return new Response(Buffer.from('%PDF-1.7 signed'), { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  const envelope = await getDocumensoEnvelope(config, 'envelope_test123', fetcher);
  assert.equal(envelope.status, 'COMPLETED');
  assert.equal(envelope.signerEmail, submission.signerEmail);
  assert.deepEqual(envelope.envelopeItems, [{ id: 'envelope_item_test123' }]);
  assert.equal((await getSignedDocumensoDocument(config, envelope.envelopeItems[0].id, fetcher)).toString(), '%PDF-1.7 signed');
});

test('treats a deleted Documenso envelope as terminal and resendable', async () => {
  const envelope = await getDocumensoEnvelope(config, 'envelope_deleted', async () => new Response(null, { status: 404 }));
  assert.equal(envelope.status, 'deleted');
  assert.equal(envelope.id, 'envelope_deleted');
  assert.deepEqual(envelope.envelopeItems, []);
  assert.equal(canStartAuthorizationSigning(envelope.status), true);
});

test('keeps an interrupted create or send outcome explicit and avoids treating it as safe to retry', async () => {
  await assert.rejects(
    createRepairAuthorizationEnvelope(config, submission, async () => new Response(null, { status: 503 })),
    /outcome is unknown/,
  );
  await assert.rejects(
    distributeDocumensoEnvelope(config, 'envelope_test123', async () => { throw new Error('connection reset'); }),
    /outcome is unknown/,
  );
});

test('validates required API credentials and signed PDF content', async () => {
  assert.throws(() => getDocumensoApiConfig({}), /DOCUMENSO_API_TOKEN/);
  await assert.rejects(
    getSignedDocumensoDocument(config, 'item', async () => new Response('not a PDF')),
    /not a PDF/,
  );
});
