import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import {
  getDocuSealApiConfig,
  getDocuSealWebhookSecret,
  getSignedDocuSealDocuments,
  verifyDocuSealSignature,
} from '../docuseal.js';

const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const signedDocumentDescription = (submissionId: string) => `Signed copy received from DocuSeal submission ${submissionId}`;

export function createDocuSealWebhookRouter(prisma: PrismaClient) {
  const router = Router();

  router.post('/', asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'Raw JSON request body is required');
    const secret = getDocuSealWebhookSecret();
    if (!verifyDocuSealSignature(req.header('X-Docuseal-Signature'), req.body, secret)) {
      throw new ApiError(401, 'Invalid DocuSeal webhook signature');
    }

    let event: unknown;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw new ApiError(400, 'Webhook body must contain valid JSON');
    }
    if (!isRecord(event)) throw new ApiError(400, 'Invalid DocuSeal webhook event');
    if (event.event_type !== 'submission.completed') {
      res.status(204).send();
      return;
    }
    if (!isRecord(event.data)) throw new ApiError(400, 'Completed event data is missing');
    const submissionId = readSubmissionId(event.data.id);
    if (!submissionId) throw new ApiError(400, 'Completed event submission ID is invalid');
    const completedAt = parseEventTimestamp(event.timestamp);
    const externalAuthorizationId = findExternalAuthorizationId(event.data);
    let authorization = await prisma.repairAuthorization.findUnique({
      where: { docusealSubmissionId: submissionId },
      include: { job: { select: { claimId: true } } },
    });
    if (!authorization && externalAuthorizationId) {
      authorization = await prisma.repairAuthorization.findUnique({
        where: { id: externalAuthorizationId },
        include: { job: { select: { claimId: true } } },
      });
    }
    if (!authorization) {
      res.status(204).send();
      return;
    }
    if (authorization.docusealCompletedAt) {
      res.status(204).send();
      return;
    }

    const signerEmail = findSignerEmail(event.data) || authorization.docusealSignerEmail;
    const claimed = await prisma.repairAuthorization.updateMany({
      where: {
        id: authorization.id,
        docusealCompletedAt: null,
        docusealStatus: { not: 'downloading' },
        OR: [{ docusealSubmissionId: submissionId }, { docusealSubmissionId: null }],
      },
      data: {
        docusealSubmissionId: submissionId,
        docusealSignerEmail: signerEmail,
        docusealStatus: 'downloading',
      },
    });
    if (!claimed.count) {
      res.status(204).send();
      return;
    }

    try {
      const documents = await getSignedDocuSealDocuments(getDocuSealApiConfig(), submissionId);
      await persistSignedDocuments(
        prisma,
        authorization.id,
        authorization.jobId,
        authorization.job.claimId,
        submissionId,
        completedAt,
        documents,
      );
    } catch (error) {
      await prisma.repairAuthorization.updateMany({
        where: { id: authorization.id, docusealStatus: 'downloading' },
        data: { docusealStatus: 'download_failed' },
      });
      throw error;
    }
    res.status(204).send();
  }));

  return router;
}

async function persistSignedDocuments(
  prisma: PrismaClient,
  authorizationId: string,
  jobId: string,
  claimId: string | null,
  submissionId: string,
  completedAt: Date,
  documents: Awaited<ReturnType<typeof getSignedDocuSealDocuments>>,
) {
  await mkdir(uploadDirectory, { recursive: true });
  const stored: Array<{ absolutePath: string; fileName: string; filePath: string; description: string }> = [];
  const jobDocuments: Array<{ fileName: string; filePath: string; documentType: string; description: string }> = [];
  const claimDocuments: Array<{ fileName: string; filePath: string; documentType: string; description: string }> = [];
  try {
    for (const document of documents) {
      const safeName = path.basename(document.name).replace(/[^a-zA-Z0-9._() -]/g, '_').trim() || 'signed-authorization.pdf';
      const fileName = `signed-${safeName}`;
      const description = signedDocumentDescription(submissionId);
      const storeCopy = async () => {
        const absolutePath = path.join(uploadDirectory, `${randomUUID()}-${fileName}`);
        await writeFile(absolutePath, document.content, { flag: 'wx' });
        const filePath = path.relative(process.cwd(), absolutePath);
        stored.push({ absolutePath, fileName, filePath, description });
        return { fileName, filePath, documentType: 'repair_authorization', description };
      };
      jobDocuments.push(await storeCopy());
      if (claimId) claimDocuments.push(await storeCopy());
    }

    await prisma.$transaction(async (tx) => {
      await tx.jobDocument.createMany({
        data: jobDocuments.map((file) => ({ jobId, ...file })),
      });
      if (claimId) {
        await tx.claimDocument.createMany({
          data: claimDocuments.map((file) => ({ claimId, ...file })),
        });
      }
      await tx.repairAuthorization.update({
        where: { id: authorizationId },
        data: { docusealStatus: 'completed', docusealCompletedAt: completedAt },
      });
    });
  } catch (error) {
    for (const file of stored) {
      try {
        await unlink(file.absolutePath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
      }
    }
    throw error;
  }
}

function findExternalAuthorizationId(data: Record<string, unknown>): string | undefined {
  const submitters = Array.isArray(data.submitters) ? data.submitters.filter(isRecord) : [];
  for (const submitter of submitters) {
    if (typeof submitter.external_id === 'string' && submitter.external_id) return submitter.external_id;
  }
  const metadataAuthorizationId = readAuthorizationMetadata(data.metadata);
  if (metadataAuthorizationId) return metadataAuthorizationId;
  return submitters.map((submitter) => readAuthorizationMetadata(submitter.metadata)).find(Boolean);
}

function readAuthorizationMetadata(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.repair_authorization_id === 'string' && value.repair_authorization_id
    ? value.repair_authorization_id
    : undefined;
}

function findSignerEmail(data: Record<string, unknown>): string | undefined {
  if (!Array.isArray(data.submitters)) return undefined;
  for (const submitter of data.submitters) {
    if (isRecord(submitter) && typeof submitter.email === 'string' && submitter.email) return submitter.email;
  }
  return undefined;
}

function readSubmissionId(value: unknown): string | undefined {
  if (
    (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  ) {
    return String(value);
  }
  return undefined;
}

function parseEventTimestamp(value: unknown): Date {
  const date = typeof value === 'number'
    ? new Date(value < 1_000_000_000_000 ? value * 1000 : value)
    : typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new ApiError(400, 'Completed event timestamp is invalid');
  return date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
