import { ApiError } from './errors.js';
import type { AuthorizationFieldPlacement } from './authorization-fields.js';

export interface RepairAuthorizationSubmission {
  authorizationId: string;
  jobId: string | null;
  claimId: string | null;
  jobNumber: string;
  fileName: string;
  pdf: Buffer;
  signerEmail: string;
  signerName: string;
  fieldPlacements?: AuthorizationFieldPlacement[];
  documentTitle?: string;
  emailSubject?: string;
  emailMessage?: string;
}

const defaultDocumensoApiUrl = 'http://documenso:3000/api/v2';
const requestTimeoutMs = 20_000;
const maxSignedDocumentBytes = 20 * 1024 * 1024;

export class DocumensoDeliveryUnknownError extends ApiError {
  constructor(message: string) {
    super(502, message);
    this.name = 'DocumensoDeliveryUnknownError';
  }
}

export interface DocumensoApiConfig {
  apiToken: string;
  baseUrl: URL;
}

export function canStartAuthorizationSigning(status: string | null): boolean {
  return !['sending', 'send_unknown', 'downloading', 'download_failed'].includes(status || '');
}

export function getDocumensoApiConfig(env: NodeJS.ProcessEnv = process.env): DocumensoApiConfig {
  const apiToken = env.DOCUMENSO_API_TOKEN?.trim();
  if (!apiToken) throw new ApiError(503, 'DOCUMENSO_API_TOKEN is not configured');
  const rawBaseUrl = env.DOCUMENSO_API_URL?.trim() || defaultDocumensoApiUrl;
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new ApiError(503, 'DOCUMENSO_API_URL must be a valid HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new ApiError(503, 'DOCUMENSO_API_URL must be a valid HTTP(S) URL without credentials, query, or fragment');
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`;
  return { apiToken, baseUrl };
}

export function buildDocumensoPayload(submission: RepairAuthorizationSubmission) {
  const fields = (submission.fieldPlacements || []).map((field) => ({
    identifier: 0,
    type: documensoFieldType(field.type),
    page: field.page,
    positionX: percent(field.x, 612),
    positionY: percent(field.y, 792),
    width: percent(field.w, 612),
    height: percent(field.h, 792),
    fieldMeta: {
      type: field.type,
      label: field.name,
      placeholder: field.type === 'text' ? field.name : undefined,
      required: field.required,
    },
  }));
  return {
    type: 'DOCUMENT',
    title: submission.documentTitle ?? `Repair authorization ${submission.jobNumber}`,
    externalId: submission.authorizationId,
    visibility: 'ADMIN',
    recipients: [{
      email: submission.signerEmail,
      name: submission.signerName,
      role: 'SIGNER',
      fields,
    }],
    meta: {
      subject: submission.emailSubject ?? `Please sign repair authorization ${submission.jobNumber}`,
      message: submission.emailMessage ?? 'Please review and sign the attached repair authorization.',
    },
  };
}

export async function createRepairAuthorizationEnvelope(
  config: DocumensoApiConfig,
  submission: RepairAuthorizationSubmission,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.set('payload', JSON.stringify(buildDocumensoPayload(submission)));
  form.append('files', new Blob([new Uint8Array(submission.pdf)], { type: 'application/pdf' }), submission.fileName);
  const created = await request(config, 'envelope/create', { method: 'POST', body: form }, fetcher, true);
  const envelopeId = readEnvelopeId(created);
  if (!envelopeId) throw new DocumensoDeliveryUnknownError('Documenso accepted the document but returned no envelope ID');
  return envelopeId;
}

export async function distributeDocumensoEnvelope(
  config: DocumensoApiConfig,
  envelopeId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const distributed = await request(config, 'envelope/distribute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelopeId }),
  }, fetcher, true);
  if (!isRecord(distributed) || distributed.success !== true) {
    throw new DocumensoDeliveryUnknownError('Documenso created the envelope but did not confirm it was sent');
  }
}

export async function getDocumensoEnvelope(
  config: DocumensoApiConfig,
  envelopeId: string,
  fetcher: typeof fetch = fetch,
): Promise<DocumensoEnvelope> {
  const response = await requestResponse(config, `envelope/${encodeURIComponent(envelopeId)}`, { method: 'GET' }, fetcher, false, true);
  if (response.status === 404) {
    return {
      id: envelopeId,
      status: 'deleted',
      completedAt: null,
      signerEmail: null,
      envelopeItems: [],
    };
  }
  let result: unknown;
  try {
    result = await response.json() as unknown;
  } catch {
    throw new ApiError(502, 'Documenso returned an invalid API response');
  }
  if (!isRecord(result) || typeof result.id !== 'string' || !Array.isArray(result.envelopeItems)) {
    throw new ApiError(502, 'Documenso returned an invalid envelope status');
  }
  const recipients = Array.isArray(result.recipients) ? result.recipients.filter(isRecord) : [];
  const email = recipients.find((recipient) => typeof recipient.email === 'string')?.email;
  return {
    id: result.id,
    status: typeof result.status === 'string' ? result.status : 'UNKNOWN',
    completedAt: typeof result.completedAt === 'string' ? result.completedAt : null,
    signerEmail: typeof email === 'string' ? email : null,
    envelopeItems: result.envelopeItems.flatMap((item) => isRecord(item) && typeof item.id === 'string' ? [{ id: item.id }] : []),
  };
}

export async function getSignedDocumensoDocument(
  config: DocumensoApiConfig,
  envelopeItemId: string,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const response = await requestResponse(config, `envelope/item/${encodeURIComponent(envelopeItemId)}/download?version=signed`, { method: 'GET' }, fetcher, true);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxSignedDocumentBytes) {
    throw new ApiError(bytes.length ? 413 : 502, 'Documenso signed document has an invalid size');
  }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ApiError(502, 'Documenso signed document is not a PDF');
  }
  return bytes;
}

export interface DocumensoEnvelope {
  id: string;
  status: string;
  completedAt: string | null;
  signerEmail: string | null;
  envelopeItems: Array<{ id: string }>;
}

async function request(
  config: DocumensoApiConfig,
  endpoint: string,
  init: RequestInit,
  fetcher: typeof fetch,
  outcomeUnknown = false,
): Promise<unknown> {
  const response = await requestResponse(config, endpoint, init, fetcher, outcomeUnknown);
  try {
    return await response.json() as unknown;
  } catch {
    if (outcomeUnknown) throw new DocumensoDeliveryUnknownError('Documenso returned an invalid response after accepting the request');
    throw new ApiError(502, 'Documenso returned an invalid API response');
  }
}

async function requestResponse(
  config: DocumensoApiConfig,
  endpoint: string,
  init: RequestInit,
  fetcher: typeof fetch,
  outcomeUnknown = false,
  allowNotFound = false,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(new URL(endpoint, config.baseUrl), {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { ...init.headers, Authorization: config.apiToken },
    });
  } catch {
    if (outcomeUnknown) throw new DocumensoDeliveryUnknownError('Documenso signing outcome is unknown because the request could not be confirmed');
    throw new ApiError(502, 'Unable to contact Documenso');
  }
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    if (outcomeUnknown && response.status >= 500) throw new DocumensoDeliveryUnknownError(`Documenso signing outcome is unknown (${response.status})`);
    throw new ApiError(502, `Documenso rejected the signing request (${response.status})`);
  }
  return response;
}

function documensoFieldType(type: AuthorizationFieldPlacement['type']) {
  return type === 'initials' ? 'INITIALS' : type === 'signature' ? 'SIGNATURE' : type === 'date' ? 'DATE' : 'TEXT';
}

function percent(value: number, dimension: number) {
  return Number(((value / dimension) * 100).toFixed(5));
}

function readEnvelopeId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === 'string' && value.id.startsWith('envelope_')
    ? value.id
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
