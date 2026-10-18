import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  buildDocuSealSubmissionPayload,
  DocuSealDeliveryUnknownError,
  getDocuSealSendConfig,
  getSignedDocuSealDocuments,
  parseDocuSealFieldPlacements,
  sendRepairAuthorizationToDocuSeal,
  verifyDocuSealSignature,
} from '../src/docuseal.js';

const config = getDocuSealSendConfig({
  DOCUSEAL_API_KEY: 'test-key',
  DOCUSEAL_BASE_URL: 'https://sign.example.test/api',
});

const pdf = Buffer.from('%PDF-1.4 repair authorization');
const submission = {
  authorizationId: 'authorization-1',
  jobId: 'job-1',
  claimId: null,
  jobNumber: 'JOB-104',
  fileName: 'repair-authorization-JOB-104.pdf',
  pdf,
  signerEmail: 'customer@example.test',
  signerName: 'Casey Customer',
};

test('builds a PDF submission with aligned required signature and date fields', () => {
  const payload = buildDocuSealSubmissionPayload(config, submission);

  assert.equal(payload.send_email, true);
  assert.equal(payload.documents[0].name, 'repair-authorization-JOB-104.pdf');
  assert.equal(Buffer.from(payload.documents[0].file, 'base64').toString(), pdf.toString());
  assert.deepEqual(payload.documents[0].fields, [
    {
      name: 'Signature',
      type: 'signature',
      role: 'Customer',
      required: true,
      areas: [{ x: 298, y: 863, w: 230, h: 11, page: 1 }],
    },
    {
      name: 'Date',
      type: 'date',
      role: 'Customer',
      required: true,
      areas: [{ x: 543, y: 863, w: 221, h: 11, page: 1 }],
    },
  ]);
  assert.deepEqual(payload.submitters[0], {
    name: 'Casey Customer',
    email: 'customer@example.test',
    role: 'Customer',
    external_id: 'authorization-1',
    metadata: { job_id: 'job-1', repair_authorization_id: 'authorization-1' },
  });

  const claimPayload = buildDocuSealSubmissionPayload(config, {
    ...submission,
    jobId: null,
    claimId: 'claim-1',
    jobNumber: 'CLM-104',
  });
  assert.deepEqual(claimPayload.submitters[0].metadata, {
    claim_id: 'claim-1',
    repair_authorization_id: 'authorization-1',
  });

  test('parses persisted field placements and rejects corrupt or out-of-page layouts', () => {
    assert.equal(parseDocuSealFieldPlacements(null), undefined);
    const fields = [
      { name: 'Initials', type: 'initials', required: true, x: 20, y: 20, w: 40, h: 10, page: 1 },
      { name: 'Signature', type: 'signature', required: true, x: 20, y: 750, w: 160, h: 10, page: 1 },
    ];
    assert.deepEqual(parseDocuSealFieldPlacements(JSON.stringify(fields)), fields);
    assert.throws(() => parseDocuSealFieldPlacements('{bad json'), /field placements are invalid/);
    assert.throws(() => parseDocuSealFieldPlacements(JSON.stringify([{ ...fields[0], x: 600 }])), /field placements are invalid/);
  });
});

test('sends to DocuSeal with server authentication and saves its submission identifier', async () => {
  let receivedUrl = '';
  let receivedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    receivedUrl = String(input);
    receivedInit = init;
    return new Response(JSON.stringify([{ id: 44, submission_id: 81, status: 'sent' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await sendRepairAuthorizationToDocuSeal(config, submission, fetcher);

  assert.equal(receivedUrl, 'https://sign.example.test/api/submissions/pdf');
  assert.equal((receivedInit?.headers as Record<string, string>)['X-Auth-Token'], 'test-key');
  const requestBody = String(receivedInit?.body);
  assert.equal((JSON.parse(requestBody) as { documents: Array<{ file: string }> }).documents[0].file, pdf.toString('base64'));
  assert.equal(requestBody.includes(config.apiKey), false);
  assert.equal(result.submissionId, '81');
  assert.equal(result.status, 'sent');
});

test('treats an interrupted DocuSeal send as an unknown outcome instead of inviting an unsafe retry', async () => {
  const fetcher: typeof fetch = async () => {
    throw new TypeError('connection closed');
  };

  await assert.rejects(
    sendRepairAuthorizationToDocuSeal(config, submission, fetcher),
    (error: unknown) => error instanceof DocuSealDeliveryUnknownError && /outcome is unknown/.test(error.message),
  );
});

test('downloads only PDFs from the configured DocuSeal origin and omits API credentials from signed-file requests', async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), headers });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        id: 81,
        documents: [{ name: 'signed-authorization.pdf', url: '/file/signed-authorization.pdf' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(Buffer.from('%PDF-signed'), { status: 200 });
  };

  const documents = await getSignedDocuSealDocuments(config, '81', fetcher);

  assert.equal(documents.length, 1);
  assert.equal(documents[0].name, 'signed-authorization.pdf');
  assert.equal(documents[0].content.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(calls[0].headers.get('X-Auth-Token'), 'test-key');
  assert.equal(calls[1].headers.has('X-Auth-Token'), false);
});

test('rejects signed-document URLs outside the configured DocuSeal origin', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    documents: [{ name: 'signed.pdf', url: 'https://attacker.example.test/signed.pdf' }],
  }), { status: 200 });

  await assert.rejects(getSignedDocuSealDocuments(config, '81', fetcher), /outside its configured server/);
});

test('validates DocuSeal webhook HMAC against the exact raw body and five-minute timestamp window', () => {
  const timestamp = 1_800_000_000;
  const body = Buffer.from('{"event_type":"submission.completed"}');
  const secret = 'whsec-test-secret';
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  const header = `${timestamp}.${signature}`;

  assert.equal(verifyDocuSealSignature(header, body, secret, timestamp), true);
  assert.equal(verifyDocuSealSignature(header, Buffer.from(`${body.toString()} `), secret, timestamp), false);
  assert.equal(verifyDocuSealSignature(header, body, secret, timestamp + 301), false);
  assert.equal(verifyDocuSealSignature(header, body, secret, timestamp - 301), false);
  assert.equal(verifyDocuSealSignature(`invalid.${signature}`, body, secret, timestamp), false);
});

test('requires API credentials but does not require a template ID', () => {
  assert.equal(getDocuSealSendConfig({ DOCUSEAL_API_KEY: 'test-key' }).signerRole, 'Customer');
  assert.throws(() => getDocuSealSendConfig({}), /DOCUSEAL_API_KEY/);
});
