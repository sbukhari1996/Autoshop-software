import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

const defaultDocuSealApiUrl = 'http://docuseal:3000/api';
const requestTimeoutMs = 15_000;
const maxSignedDocumentBytes = 20 * 1024 * 1024;

export class DocuSealDeliveryUnknownError extends ApiError {
  constructor(message: string) {
    super(502, message);
    this.name = 'DocuSealDeliveryUnknownError';
  }
}

export interface DocuSealApiConfig {
  apiKey: string;
  baseUrl: URL;
}

export interface DocuSealSendConfig extends DocuSealApiConfig {
  signerRole: string;
}

export interface RepairAuthorizationSubmission {
  authorizationId: string;
  jobId: string | null;
  claimId: string | null;
  jobNumber: string;
  fileName: string;
  pdf: Buffer;
  signerEmail: string;
  signerName: string;
  fieldPlacements?: DocuSealFieldPlacement[];
}

export interface DocuSealFieldPlacement {
  name: string;
  type: 'initials' | 'signature' | 'date' | 'text';
  required: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

export interface SignedDocuSealDocument {
  name: string;
  content: Buffer;
}

export function getDocuSealApiConfig(env: NodeJS.ProcessEnv = process.env): DocuSealApiConfig {
  const apiKey = env.DOCUSEAL_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'DOCUSEAL_API_KEY is not configured');

  const rawBaseUrl = env.DOCUSEAL_BASE_URL?.trim() || defaultDocuSealApiUrl;
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new ApiError(503, 'DOCUSEAL_BASE_URL must be a valid HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new ApiError(503, 'DOCUSEAL_BASE_URL must be a valid HTTP(S) URL without credentials, query, or fragment');
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`;

  return { apiKey, baseUrl };
}

export function getDocuSealSendConfig(env: NodeJS.ProcessEnv = process.env): DocuSealSendConfig {
  const apiConfig = getDocuSealApiConfig(env);
  return {
    ...apiConfig,
    signerRole: env.DOCUSEAL_SIGNER_ROLE?.trim() || 'Customer',
  };
}

export function getDocuSealWebhookSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.DOCUSEAL_WEBHOOK_SECRET?.trim();
  if (!secret) throw new ApiError(503, 'DOCUSEAL_WEBHOOK_SECRET is not configured');
  return secret;
}

export function verifyDocuSealSignature(
  header: string | undefined,
  rawBody: Buffer,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const match = header?.match(/^(\d{1,12})\.([a-f0-9]{64})$/i);
  if (!match) return false;

  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  const received = Buffer.from(match[2], 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function buildDocuSealSubmissionPayload(
  config: Pick<DocuSealSendConfig, 'signerRole'>,
  submission: RepairAuthorizationSubmission,
) {
  // PDFKit positions in points; DocuSeal's area API uses pixels at 96 px/in.
  const pixelsPerPoint = 96 / 72;
  // Keep signing boxes below the printed labels in the existing 24-point signature row.
  const area = (x: number, y: number, w: number, h: number) => ({
    x: Math.ceil(x * pixelsPerPoint),
    y: Math.ceil(y * pixelsPerPoint),
    w: Math.floor(w * pixelsPerPoint),
    h: Math.floor(h * pixelsPerPoint),
    page: 1,
  });
  const fieldPlacements = submission.fieldPlacements || [
    { name: 'Signature', type: 'signature', required: true, x: 223, y: 646.5484, w: 173, h: 8.5, page: 1 },
    { name: 'Date', type: 'date', required: true, x: 407, y: 646.5484, w: 166, h: 8.5, page: 1 },
  ];
  return {
    name: `Repair authorization ${submission.jobNumber}`,
    send_email: true,
    documents: [{
      name: submission.fileName,
      file: submission.pdf.toString('base64'),
      fields: fieldPlacements.map((field) => ({
        name: field.name,
        type: field.type,
        role: config.signerRole,
        required: field.required,
        areas: [area(field.x, field.y, field.w, field.h)],
      })),
    }],
    submitters: [{
      name: submission.signerName,
      email: submission.signerEmail,
      role: config.signerRole,
      external_id: submission.authorizationId,
      metadata: {
        ...(submission.jobId ? { job_id: submission.jobId } : {}),
        ...(submission.claimId ? { claim_id: submission.claimId } : {}),
        repair_authorization_id: submission.authorizationId,
      },
    }],
  };
}

export function parseDocuSealFieldPlacements(serialized: string | null): DocuSealFieldPlacement[] | undefined {
  if (serialized === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ApiError(500, 'Stored DocuSeal field placements are invalid');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) {
    throw new ApiError(500, 'Stored DocuSeal field placements are invalid');
  }

  const placements: DocuSealFieldPlacement[] = [];
  for (const field of parsed) {
    if (typeof field !== 'object' || field === null || Array.isArray(field)) {
      throw new ApiError(500, 'Stored DocuSeal field placements are invalid');
    }
    const value = field as Record<string, unknown>;
    const { name, type, required, x, y, w, h } = value;
    if (
      typeof name !== 'string' || !name ||
      !isDocuSealFieldType(type) ||
      typeof required !== 'boolean' ||
      value.page !== 1 ||
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof w !== 'number' || !Number.isFinite(w) ||
      typeof h !== 'number' || !Number.isFinite(h) ||
      x < 0 || y < 0 || w <= 0 || h <= 0 ||
      x + w > 612 || y + h > 792
    ) {
      throw new ApiError(500, 'Stored DocuSeal field placements are invalid');
    }
    placements.push({ name, type, required, x, y, w, h, page: 1 });
  }
  return placements;
}

function isDocuSealFieldType(value: unknown): value is DocuSealFieldPlacement['type'] {
  return value === 'initials' || value === 'signature' || value === 'date' || value === 'text';
}

export async function sendRepairAuthorizationToDocuSeal(
  config: DocuSealSendConfig,
  submission: RepairAuthorizationSubmission,
  fetcher: typeof fetch = fetch,
): Promise<{ submissionId: string; status: string }> {
  const response = await docuSealFetch(config, 'submissions/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildDocuSealSubmissionPayload(config, submission)),
  }, fetcher);
  if (!response.ok) {
    if (response.status >= 500) {
      throw new DocuSealDeliveryUnknownError(`DocuSeal signing outcome is unknown (${response.status})`);
    }
    throw new ApiError(502, `DocuSeal rejected the signing request (${response.status})`);
  }

  const result = await response.json().catch(() => {
    throw new DocuSealDeliveryUnknownError('DocuSeal accepted the request but returned an invalid signing response');
  }) as unknown;
  const responseItems = Array.isArray(result) ? result : [result];
  const submissionId = responseItems.map(readSubmissionId).find((id): id is string => Boolean(id));
  if (!submissionId) throw new DocuSealDeliveryUnknownError('DocuSeal accepted the request but did not return a submission ID');

  const responseStatus = responseItems.map(readSubmissionStatus).find((status): status is string => Boolean(status));
  return { submissionId, status: responseStatus || 'sent' };
}

export async function getSignedDocuSealDocuments(
  config: DocuSealApiConfig,
  submissionId: string,
  fetcher: typeof fetch = fetch,
): Promise<SignedDocuSealDocument[]> {
  const encodedId = encodeURIComponent(submissionId);
  const response = await docuSealFetch(config, `submissions/${encodedId}/documents`, {}, fetcher);
  if (!response.ok) throw new ApiError(502, `DocuSeal could not return signed documents (${response.status})`);

  const result = await response.json().catch(() => {
    throw new ApiError(502, 'DocuSeal returned an invalid signed-documents response');
  }) as unknown;
  if (!isRecord(result) || !Array.isArray(result.documents) || !result.documents.length) {
    throw new ApiError(502, 'DocuSeal returned no signed documents');
  }
  if (result.documents.length > 10) throw new ApiError(502, 'DocuSeal returned more than 10 signed documents');

  const documents: SignedDocuSealDocument[] = [];
  for (const item of result.documents) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.url !== 'string') {
      throw new ApiError(502, 'DocuSeal returned an invalid signed-document entry');
    }
    const documentUrl = new URL(item.url, config.baseUrl);
    if (documentUrl.origin !== config.baseUrl.origin || !['http:', 'https:'].includes(documentUrl.protocol)) {
      throw new ApiError(502, 'DocuSeal returned a signed-document URL outside its configured server');
    }
    const fileResponse = await docuSealFetch(config, documentUrl, {}, fetcher, false);
    if (!fileResponse.ok) throw new ApiError(502, `DocuSeal signed-document download failed (${fileResponse.status})`);
    const contentLength = Number(fileResponse.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxSignedDocumentBytes) {
      throw new ApiError(502, 'DocuSeal signed document exceeds the 20 MiB limit');
    }
    const content = await readLimitedResponse(fileResponse);
    if (content.length < 5 || content.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new ApiError(502, 'DocuSeal returned a signed document that is not a PDF');
    }
    documents.push({ name: item.name, content });
  }

  return documents;
}

async function docuSealFetch(
  config: DocuSealApiConfig,
  endpoint: string | URL,
  init: RequestInit,
  fetcher: typeof fetch,
  authenticate = true,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(endpoint instanceof URL ? endpoint : new URL(endpoint, config.baseUrl), {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
      redirect: 'error',
      headers: {
        ...(authenticate ? { 'X-Auth-Token': config.apiKey } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new DocuSealDeliveryUnknownError('DocuSeal request timed out; delivery outcome is unknown');
    }
    if (error instanceof TypeError) throw new DocuSealDeliveryUnknownError('DocuSeal API is unavailable; delivery outcome is unknown');
    throw error;
  }
  return response;
}

async function readLimitedResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxSignedDocumentBytes) {
      await reader.cancel();
      throw new ApiError(502, 'DocuSeal signed document exceeds the 20 MiB limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

function readSubmissionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const submission = isRecord(value.submission) ? value.submission : value;
  const id = submission.submission_id ?? submission.id;
  if (
    (typeof id === 'string' && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0) ||
    (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
  ) {
    return String(id);
  }
  return undefined;
}

function readSubmissionStatus(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status;
  return typeof status === 'string' && status.trim() ? status.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
