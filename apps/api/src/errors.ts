import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'A record with those unique values already exists' });
      return;
    }

    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Related record not found' });
      return;
    }
  }

  console.error('Unhandled API error', error);
  res.status(500).json({ error: 'Internal server error' });
};