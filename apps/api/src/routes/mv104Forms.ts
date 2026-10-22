import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth } from '../auth.js';
import { ApiError, asyncHandler } from '../errors.js';
import type { AuthorizationFieldPlacement } from '../authorization-fields.js';
import {
  DocumensoDeliveryUnknownError,
  createRepairAuthorizationEnvelope,
  distributeDocumensoEnvelope,
  getDocumensoApiConfig,
  getDocumensoEnvelope,
  getSignedDocumensoDocument,
} from '../documenso.js';
import { fillMv104, type Mv104Input } from '../mv104/mv104Form.js';
import { buildMv104Defaults, missingRequiredFields } from '../mv104/mv104Prefill.js';
import { STANDALONE_MV104, loadMv104Source, mergeInput } from './mv104.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const editableStatuses = ['draft', 'send_failed'];

// Signature and date boxes on MV-104 page 1, in PDF points measured from the top-left of the 612 x 792 page.
// The signature sits on the "Signature of Driver" box; the date sits in the printed "Date" box.
const SIGNING_FIELDS: AuthorizationFieldPlacement[] = [
  { name: 'Signature of driver or representative', type: 'signature', required: true, x: 330, y: 674, w: 255, h: 20, page: 1 },
  { name: 'Date signed', type: 'date', required: true, x: 19, y: 674, w: 72, h: 20, page: 1 },
];

interface MvFormRow {
  id: string;
  claimId: string | null;
  title: string;
  status: string;
  input: string;
  signerName: string | null;
  signerEmail: string | null;
  documensoEnvelopeId: string | null;
  documensoStatus: string | null;
  sentAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

function idOf(req: { params: Record<string, string | string[]> }) {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] : value;
}

function cleanText(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'MV-104';
}

function defaultTitle(input: Mv104Input) {
  return `MV-104 crash ${input.crash.month}/${input.crash.day}/${input.crash.year}`;
}

function summary(row: MvFormRow) {
  return {
    id: row.id,
    claimId: row.claimId,
    title: row.title,
    status: row.status,
    signerName: row.signerName,
    signerEmail: row.signerEmail,
    documensoStatus: row.documensoStatus,
    sentAt: row.sentAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function withInput(row: MvFormRow) {
  return { ...summary(row), input: JSON.parse(row.input) as Mv104Input };
}

export function createMv104FormsRouter(prisma: PrismaClient) {
  const router = Router();

  const findForm = async (id: string): Promise<MvFormRow> => {
    const row = await prisma.mv104Form.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, 'MV-104 not found');
    return row;
  };

  // Saved MV-104s, newest first. Pass ?claimId=... to list one claim's forms.
  router.get('/mv104-forms', asyncHandler(async (req, res) => {
    const claimId = typeof req.query.claimId === 'string' && req.query.claimId ? req.query.claimId : undefined;
    const rows = await prisma.mv104Form.findMany({ where: claimId ? { claimId } : undefined, orderBy: { updatedAt: 'desc' }, take: 200 });
    res.json(rows.map(summary));
  }));

  router.post('/mv104-forms', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { claimId?: string | null; title?: string; input?: unknown };
    const claimId = body.claimId && body.claimId !== STANDALONE_MV104 ? body.claimId : null;
    const source = await loadMv104Source(prisma, claimId);
    const input = mergeInput(buildMv104Defaults(source), body.input);
    const row = await prisma.mv104Form.create({
      data: { claimId, title: cleanText(body.title) || defaultTitle(input), input: JSON.stringify(input) },
    });
    res.status(201).json(withInput(row));
  }));

  router.get('/mv104-forms/:id', asyncHandler(async (req, res) => {
    res.json(withInput(await findForm(idOf(req))));
  }));

  // Saves changes to a draft. Once sent for signature, the form is locked.
  router.put('/mv104-forms/:id', asyncHandler(async (req, res) => {
    const form = await findForm(idOf(req));
    if (!editableStatuses.includes(form.status)) throw new ApiError(409, 'This MV-104 was sent for signature and can no longer be edited');
    const body = (req.body ?? {}) as { title?: string; input?: unknown };
    const source = await loadMv104Source(prisma, form.claimId);
    const input = mergeInput(buildMv104Defaults(source), body.input ?? JSON.parse(form.input));
    const row = await prisma.mv104Form.update({
      where: { id: form.id },
      data: { title: cleanText(body.title) || form.title, input: JSON.stringify(input) },
    });
    res.json(withInput(row));
  }));

  // Sends the saved MV-104 to Documenso with signature and date boxes. The signer dates it when signing,
  // so the printed date is cleared from the sent copy.
  router.post('/mv104-forms/:id/send', requireAuth, asyncHandler(async (req, res) => {
    const form = await findForm(idOf(req));
    if (!editableStatuses.includes(form.status)) throw new ApiError(409, 'This MV-104 has already been sent for signature');
    const body = (req.body ?? {}) as { name?: string; email?: string };
    const signerName = cleanText(body.name);
    const signerEmail = cleanText(body.email, 200);
    if (!signerName) throw new ApiError(400, 'Enter the signer name');
    if (!emailPattern.test(signerEmail)) throw new ApiError(400, 'Enter a valid signer email');

    const config = getDocumensoApiConfig();
    const saved = JSON.parse(form.input) as Mv104Input;
    const input: Mv104Input = { ...saved, signing: { ...saved.signing, date: '' } };
    const missing = missingRequiredFields(input);
    if (missing.length > 0) throw new ApiError(422, `Complete these before sending: ${missing.join('; ')}`);
    const pdf = Buffer.from(await fillMv104(input));

    const claimed = await prisma.mv104Form.updateMany({
      where: { id: form.id, status: { in: editableStatuses } },
      data: { status: 'sending', signerName, signerEmail, input: JSON.stringify(input) },
    });
    if (!claimed.count) throw new ApiError(409, 'This MV-104 is already being sent');

    let envelopeId: string | undefined;
    try {
      envelopeId = await createRepairAuthorizationEnvelope(config, {
        authorizationId: form.id,
        jobId: null,
        claimId: form.claimId,
        jobNumber: form.title,
        fileName: `${safeName(form.title)}.pdf`,
        pdf,
        signerEmail,
        signerName,
        fieldPlacements: SIGNING_FIELDS,
        documentTitle: `MV-104 crash report ${form.title}`,
        emailSubject: 'Please sign MV-104 crash report',
        emailMessage: 'Please review, sign and date the attached MV-104 crash report.',
      });
      const saveEnvelope = await prisma.mv104Form.updateMany({
        where: { id: form.id, status: 'sending', documensoEnvelopeId: null },
        data: { documensoEnvelopeId: envelopeId, documensoStatus: 'sending' },
      });
      if (!saveEnvelope.count) throw new ApiError(502, 'Documenso created a draft, but its envelope ID could not be saved; check Documenso before retrying');
      await distributeDocumensoEnvelope(config, envelopeId);
      const sent = await prisma.mv104Form.update({
        where: { id: form.id },
        data: { status: 'sent', documensoStatus: 'sent', sentAt: new Date() },
      });
      res.status(201).json(withInput(sent));
    } catch (error) {
      await prisma.mv104Form.updateMany({
        where: { id: form.id, status: 'sending' },
        data: { status: error instanceof DocumensoDeliveryUnknownError || envelopeId ? 'send_unknown' : 'send_failed' },
      });
      throw error;
    }
  }));

  // Checks Documenso for the signer's progress and records completion.
  router.post('/mv104-forms/:id/refresh', requireAuth, asyncHandler(async (req, res) => {
    const form = await findForm(idOf(req));
    if (!form.documensoEnvelopeId) throw new ApiError(409, 'This MV-104 has not been sent for signature');
    const envelope = await getDocumensoEnvelope(getDocumensoApiConfig(), form.documensoEnvelopeId);
    const completed = envelope.status.toUpperCase().includes('COMPLETE');
    const row = await prisma.mv104Form.update({
      where: { id: form.id },
      data: {
        documensoStatus: envelope.status,
        ...(completed
          ? { status: 'signed', completedAt: form.completedAt ?? (envelope.completedAt ? new Date(envelope.completedAt) : new Date()) }
          : {}),
      },
    });
    res.json(withInput(row));
  }));

  router.get('/mv104-forms/:id/signed.pdf', requireAuth, asyncHandler(async (req, res) => {
    const form = await findForm(idOf(req));
    if (form.status !== 'signed' || !form.documensoEnvelopeId) throw new ApiError(409, 'The signed copy is available after the signer completes the form');
    const config = getDocumensoApiConfig();
    const envelope = await getDocumensoEnvelope(config, form.documensoEnvelopeId);
    const itemId = envelope.envelopeItems[0]?.id;
    if (!itemId) throw new ApiError(502, 'Documenso returned no document for this envelope');
    const bytes = await getSignedDocumensoDocument(config, itemId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(form.title)}-signed.pdf"`);
    res.send(bytes);
  }));

  return router;
}
