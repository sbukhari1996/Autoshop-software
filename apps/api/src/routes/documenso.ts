import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../auth.js';
import { ApiError, asyncHandler } from '../errors.js';
import { parseAuthorizationFieldPlacements } from '../authorization-fields.js';
import { dopAuthorizationFileName } from '../authorization-document-name.js';
import {
  DocumensoDeliveryUnknownError,
  createRepairAuthorizationEnvelope,
  distributeDocumensoEnvelope,
  canResendCompletedAuthorization,
  getDocumensoApiConfig,
  getDocumensoEnvelope,
  getSignedDocumensoDocument,
} from '../documenso.js';
import { readAuthorizationPdf } from './authorization-files.js';
import { regenerateAuthorizationPdf } from './operations.js';

const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createDocumensoRouter(prisma: PrismaClient) {
  const router = Router();

  router.post('/repair-authorizations/:authorizationId/send', requireAuth, asyncHandler(async (req, res) => {
    if (!process.env.DOCUMENSO_API_TOKEN?.trim()) throw new ApiError(503, 'Documenso API is not configured');
    const authorization = await prisma.repairAuthorization.findUnique({
      where: { id: routeParam(req.params.authorizationId) },
      include: { job: true, claim: true },
    });
    if (!authorization) throw new ApiError(404, 'Repair authorization not found');
    if (authorization.legacyDocuSealSubmissionId) {
      throw new ApiError(409, 'This authorization has a legacy DocuSeal signing record and cannot be resent');
    }
    const isCompleted = canResendCompletedAuthorization(authorization.documensoStatus, authorization.documensoCompletedAt);
    if (authorization.documensoEnvelopeId && !isCompleted) throw new ApiError(409, 'This repair authorization already has an active or unresolved Documenso request');
    if (authorization.documensoStatus === 'sending' || authorization.documensoStatus === 'send_unknown') {
      throw new ApiError(409, 'This authorization may already have been sent; check Documenso before retrying');
    }
    const recipient = signingRecipient(req.body);
    const config = getDocumensoApiConfig();
    const claimed = await prisma.repairAuthorization.updateMany({
      where: {
        id: authorization.id,
        documensoEnvelopeId: authorization.documensoEnvelopeId,
        documensoCompletedAt: authorization.documensoCompletedAt,
        documensoStatus: authorization.documensoStatus,
      },
      data: {
        documensoEnvelopeId: null,
        documensoCompletedAt: null,
        documensoSignerEmail: recipient.email,
        documensoStatus: 'sending',
      },
    });
    if (!claimed.count) throw new ApiError(409, 'This repair authorization is already being sent');

    let envelopeId: string | undefined;
    try {
      await regenerateAuthorizationPdf(prisma, authorization.id);
      const pdf = await readAuthorizationPdf(authorization.filePath);
      const refreshedAuthorization = await prisma.repairAuthorization.findUnique({ where: { id: authorization.id } });
      if (!refreshedAuthorization) throw new ApiError(404, 'Repair authorization not found');
      envelopeId = await createRepairAuthorizationEnvelope(config, {
        authorizationId: authorization.id,
        jobId: authorization.jobId,
        claimId: authorization.claimId,
        jobNumber: authorization.job?.jobNumber || authorization.claim?.claimNumber || authorization.claimId || authorization.id,
        fileName: authorization.fileName,
        pdf,
        signerEmail: recipient.email,
        signerName: recipient.name,
        fieldPlacements: parseAuthorizationFieldPlacements(refreshedAuthorization.authorizationFields),
      });
      const savedEnvelope = await prisma.repairAuthorization.updateMany({
        where: { id: authorization.id, documensoStatus: 'sending', documensoEnvelopeId: null },
        data: { documensoEnvelopeId: envelopeId, documensoSignerEmail: recipient.email, documensoStatus: 'sending' },
      });
      if (!savedEnvelope.count) throw new ApiError(502, 'Documenso created a draft, but its envelope ID could not be saved; check Documenso before retrying');
      await distributeDocumensoEnvelope(config, envelopeId);
      await prisma.repairAuthorization.updateMany({
        where: { id: authorization.id, documensoStatus: 'sending', documensoEnvelopeId: envelopeId },
        data: { documensoStatus: 'sent' },
      });
      const current = await prisma.repairAuthorization.findUnique({ where: { id: authorization.id } });
      if (current?.documensoEnvelopeId !== envelopeId) {
        throw new ApiError(502, 'Documenso accepted the request, but its envelope ID could not be saved; check Documenso before retrying');
      }
      res.status(201).json(signingStatus(current));
    } catch (error) {
      await prisma.repairAuthorization.updateMany({
        where: { id: authorization.id, documensoStatus: 'sending' },
        data: {
          documensoStatus: error instanceof DocumensoDeliveryUnknownError || envelopeId ? 'send_unknown' : 'send_failed',
        },
      });
      throw error;
    }
  }));

  router.get('/repair-authorizations/:authorizationId/signing', requireAuth, asyncHandler(async (req, res) => {
    const authorization = await prisma.repairAuthorization.findUnique({
      where: { id: routeParam(req.params.authorizationId) },
      include: {
        job: { select: { claimId: true, customer: { select: { firstName: true, lastName: true } } } },
        claim: { select: { customer: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!authorization) throw new ApiError(404, 'Repair authorization not found');
    if (!authorization.documensoEnvelopeId) {
      if (authorization.legacyDocuSealSubmissionId) {
        res.json({
          authorizationId: authorization.id,
          jobId: authorization.jobId,
          claimId: authorization.claimId,
          submissionId: authorization.legacyDocuSealSubmissionId,
          signerEmail: authorization.legacyDocuSealSignerEmail,
          status: authorization.legacyDocuSealStatus || 'legacy_provider_disabled',
          completedAt: authorization.legacyDocuSealCompletedAt,
          provider: 'legacy_docuseal',
        });
        return;
      }
      res.json({
        authorizationId: authorization.id,
        jobId: authorization.jobId,
        claimId: authorization.claimId,
        submissionId: null,
        signerEmail: null,
        status: authorization.documensoStatus || 'not_sent',
        completedAt: authorization.documensoCompletedAt,
        provider: 'documenso',
      });
      return;
    }
    if (authorization.documensoCompletedAt) {
      res.json(signingStatus(authorization));
      return;
    }

    const config = getDocumensoApiConfig();
    const envelope = await getDocumensoEnvelope(config, authorization.documensoEnvelopeId);
    const status = normalizeStatus(envelope.status);
    if (status !== 'completed') {
      await prisma.repairAuthorization.updateMany({
        where: { id: authorization.id, documensoCompletedAt: null, documensoStatus: { not: 'downloading' } },
        data: { documensoStatus: status, documensoSignerEmail: envelope.signerEmail || authorization.documensoSignerEmail },
      });
      const current = await prisma.repairAuthorization.findUnique({ where: { id: authorization.id } });
      res.json(signingStatus(current || authorization));
      return;
    }

    const claimed = await prisma.repairAuthorization.updateMany({
      where: { id: authorization.id, documensoCompletedAt: null, documensoStatus: { not: 'downloading' } },
      data: { documensoStatus: 'downloading' },
    });
    if (!claimed.count) {
      const current = await prisma.repairAuthorization.findUnique({ where: { id: authorization.id } });
      res.json(signingStatus(current || authorization));
      return;
    }

    try {
      const item = envelope.envelopeItems[0];
      if (!item) throw new ApiError(502, 'Completed Documenso envelope has no document to download');
      const pdf = await getSignedDocumensoDocument(config, item.id);
      await persistSignedDocument(
        prisma,
        authorization.id,
        authorization.jobId,
        authorization.claimId || authorization.job?.claimId || null,
        authorization.documensoEnvelopeId,
        envelope.completedAt ? new Date(envelope.completedAt) : new Date(),
        `${authorization.job?.customer.firstName || authorization.claim?.customer.firstName || ''} ${authorization.job?.customer.lastName || authorization.claim?.customer.lastName || ''}`.trim(),
        pdf,
      );
      const current = await prisma.repairAuthorization.findUnique({ where: { id: authorization.id } });
      res.json(signingStatus(current || authorization));
    } catch (error) {
      await prisma.repairAuthorization.updateMany({
        where: { id: authorization.id, documensoStatus: 'downloading' },
        data: { documensoStatus: 'download_failed' },
      });
      throw error;
    }
  }));

  return router;
}

async function persistSignedDocument(
  prisma: PrismaClient,
  authorizationId: string,
  jobId: string | null,
  claimId: string | null,
  envelopeId: string,
  completedAt: Date,
  customerName: string,
  pdf: Buffer,
) {
  if (!jobId && !claimId) throw new ApiError(500, 'Repair authorization has no claim or repair order');
  await mkdir(uploadDirectory, { recursive: true });
  const fileName = dopAuthorizationFileName(customerName);
  const description = `Signed copy received from Documenso envelope ${envelopeId}`;
  const stored: string[] = [];
  const createDocument = async () => {
    const absolutePath = path.join(uploadDirectory, `${randomUUID()}-${fileName}`);
    await writeFile(absolutePath, pdf, { flag: 'wx' });
    stored.push(absolutePath);
    return { fileName, filePath: path.relative(process.cwd(), absolutePath), documentType: 'repair_authorization', description };
  };
  try {
    const jobDocument = jobId ? await createDocument() : null;
    const claimDocument = claimId ? await createDocument() : null;
    await prisma.$transaction(async (tx) => {
      if (jobId && jobDocument) await tx.jobDocument.create({ data: { jobId, ...jobDocument } });
      if (claimId && claimDocument) await tx.claimDocument.create({ data: { claimId, ...claimDocument } });
      await tx.repairAuthorization.update({
        where: { id: authorizationId },
        data: { documensoStatus: 'completed', documensoCompletedAt: completedAt },
      });
    });
  } catch (error) {
    for (const filePath of stored) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
      }
    }
    throw error;
  }
}

function signingStatus(authorization: {
  id: string;
  jobId: string | null;
  claimId: string | null;
  documensoEnvelopeId: string | null;
  documensoSignerEmail: string | null;
  documensoStatus: string | null;
  documensoCompletedAt: Date | null;
}) {
  return {
    authorizationId: authorization.id,
    jobId: authorization.jobId,
    claimId: authorization.claimId,
    submissionId: authorization.documensoEnvelopeId,
    signerEmail: authorization.documensoSignerEmail,
    status: authorization.documensoStatus || 'not_sent',
    completedAt: authorization.documensoCompletedAt,
    provider: 'documenso',
  };
}

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !value) throw new ApiError(400, 'Authorization ID is required');
  return value;
}

function signingRecipient(body: unknown): { name: string; email: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'Recipient name and email are required in the request body');
  }
  const request = body as Record<string, unknown>;
  if (typeof request.recipientName !== 'string' || !request.recipientName.trim() || request.recipientName.trim().length > 200) {
    throw new ApiError(400, 'recipientName must be a non-empty name of at most 200 characters');
  }
  if (typeof request.recipientEmail !== 'string') throw new ApiError(400, 'recipientEmail must be a valid recipient email address');
  const email = request.recipientEmail.trim();
  if (email.length > 254 || !emailPattern.test(email)) throw new ApiError(400, 'recipientEmail must be a valid recipient email address');
  return { name: request.recipientName.trim(), email };
}

function normalizeStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'pending') return 'sent';
  if (['completed', 'rejected', 'cancelled', 'canceled', 'declined', 'expired'].includes(normalized)) return normalized;
  return normalized;
}
