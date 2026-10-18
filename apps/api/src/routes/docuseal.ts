import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../auth.js';
import { ApiError, asyncHandler } from '../errors.js';
import {
  DocuSealDeliveryUnknownError,
  getDocuSealSendConfig,
  parseDocuSealFieldPlacements,
  sendRepairAuthorizationToDocuSeal,
} from '../docuseal.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const maxAuthorizationPdfBytes = 20 * 1024 * 1024;

export function createDocuSealRouter(prisma: PrismaClient) {
  const router = Router();
  router.use(requireAuth);

  router.post('/repair-authorizations/:authorizationId/send', asyncHandler(async (req, res) => {
    const authorizationId = routeParam(req, 'authorizationId');
    const authorization = await prisma.repairAuthorization.findUnique({
      where: { id: authorizationId },
      include: { job: true, claim: true },
    });
    if (!authorization) throw new ApiError(404, 'Repair authorization not found');
    if (authorization.docusealSubmissionId) throw new ApiError(409, 'This repair authorization has already been sent to DocuSeal');
    if (authorization.docusealStatus === 'sending' || authorization.docusealStatus === 'send_unknown') {
      throw new ApiError(409, 'This repair authorization may already have been sent; check DocuSeal before retrying');
    }

    const recipient = signingRecipient(req.body);
    const pdf = await readAuthorizationPdf(authorization.filePath);
    const config = getDocuSealSendConfig();

    const claimed = await prisma.repairAuthorization.updateMany({
      where: {
        id: authorization.id,
        docusealSubmissionId: null,
        docusealStatus: authorization.docusealStatus,
      },
      data: { docusealSignerEmail: recipient.email, docusealStatus: 'sending' },
    });
    if (!claimed.count) throw new ApiError(409, 'This repair authorization is already being sent');

    let submission: { submissionId: string; status: string };
    try {
      submission = await sendRepairAuthorizationToDocuSeal(config, {
        authorizationId: authorization.id,
        jobId: authorization.jobId,
        claimId: authorization.claimId,
        jobNumber: authorization.job?.jobNumber || authorization.claim?.claimNumber || authorization.claimId || authorization.id,
        fileName: authorization.fileName,
        pdf,
        signerEmail: recipient.email,
        signerName: recipient.name,
        fieldPlacements: parseDocuSealFieldPlacements(authorization.docusealFields),
      });
    } catch (error) {
      await prisma.repairAuthorization.updateMany({
        where: { id: authorization.id, docusealStatus: 'sending', docusealSubmissionId: null },
        data: { docusealStatus: error instanceof DocuSealDeliveryUnknownError ? 'send_unknown' : 'send_failed' },
      });
      throw error;
    }

    await prisma.repairAuthorization.updateMany({
      where: { id: authorization.id, docusealStatus: 'sending', docusealSubmissionId: null },
      data: {
        docusealSubmissionId: submission.submissionId,
        docusealSignerEmail: recipient.email,
        docusealStatus: submission.status,
      },
    });

    const current = await prisma.repairAuthorization.findUnique({ where: { id: authorization.id } });
    if (!current?.docusealSubmissionId) {
      throw new ApiError(502, 'DocuSeal accepted the request, but the submission ID could not be saved; check signing status before retrying');
    }
    if (current.docusealSubmissionId !== submission.submissionId) {
      throw new ApiError(502, 'DocuSeal submission ID could not be reconciled; check signing status before retrying');
    }
    res.status(201).json(signingStatus(current));
  }));

  router.get('/repair-authorizations/:authorizationId/signing', asyncHandler(async (req, res) => {
    const authorization = await prisma.repairAuthorization.findUnique({
      where: { id: routeParam(req, 'authorizationId') },
    });
    if (!authorization) throw new ApiError(404, 'Repair authorization not found');
    res.json(signingStatus(authorization));
  }));

  return router;
}

function routeParam(req: { params: Record<string, string | string[]> }, name: string) {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`);
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
  if (typeof request.recipientEmail !== 'string') {
    throw new ApiError(400, 'recipientEmail must be a valid recipient email address');
  }
  const email = request.recipientEmail.trim();
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new ApiError(400, 'recipientEmail must be a valid recipient email address');
  }
  return { name: request.recipientName.trim(), email };
}

async function readAuthorizationPdf(filePath: string): Promise<Buffer> {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!isInsideUploadDirectory(uploadDirectory, resolvedPath)) {
    throw new ApiError(400, 'Stored authorization PDF path is invalid');
  }

  try {
    const [realUploadDirectory, realFilePath] = await Promise.all([
      realpath(uploadDirectory),
      realpath(resolvedPath),
    ]);
    if (!isInsideUploadDirectory(realUploadDirectory, realFilePath)) {
      throw new ApiError(400, 'Stored authorization PDF path is invalid');
    }
    const details = await stat(realFilePath);
    if (!details.isFile()) throw new ApiError(400, 'Stored authorization PDF is not a file');
    if (details.size > maxAuthorizationPdfBytes) {
      throw new ApiError(413, 'Stored authorization PDF exceeds the 20 MiB limit');
    }
    const contents = await readFile(realFilePath);
    if (contents.length < 5 || contents.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new ApiError(422, 'Stored authorization file is not a PDF');
    }
    return contents;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isFileSystemError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new ApiError(404, 'Stored authorization PDF not found');
    }
    throw error;
  }
}

function isInsideUploadDirectory(directory: string, filePath: string): boolean {
  const relativePath = path.relative(directory, filePath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function signingStatus(authorization: {
  id: string;
  jobId: string | null;
  docusealSubmissionId: string | null;
  docusealSignerEmail: string | null;
  docusealStatus: string | null;
  docusealCompletedAt: Date | null;
  claimId: string | null;
}) {
  return {
    authorizationId: authorization.id,
    jobId: authorization.jobId,
    claimId: authorization.claimId,
    submissionId: authorization.docusealSubmissionId,
    signerEmail: authorization.docusealSignerEmail,
    status: authorization.docusealStatus || 'not_sent',
    completedAt: authorization.docusealCompletedAt,
  };
}
