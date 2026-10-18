import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../errors.js';

const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const maxAuthorizationPdfBytes = 20 * 1024 * 1024;

export async function readAuthorizationPdf(filePath: string): Promise<Buffer> {
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
    if (details.size > maxAuthorizationPdfBytes) throw new ApiError(413, 'Stored authorization PDF exceeds the 20 MiB limit');
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
