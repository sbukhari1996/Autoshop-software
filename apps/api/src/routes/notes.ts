import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';

const colors = ['yellow', 'pink', 'blue', 'green'];

function idOf(req: { params: Record<string, string | string[]> }) {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] : value;
}

function cleanText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'Write something in the note first');
  return value.trim().slice(0, 2000);
}

function cleanColor(value: unknown) {
  return typeof value === 'string' && colors.includes(value) ? value : 'yellow';
}

export function createNotesRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/notes', asyncHandler(async (_req, res) => {
    res.json(await prisma.dashboardNote.findMany({ orderBy: { updatedAt: 'desc' }, take: 200 }));
  }));

  router.post('/notes', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { text?: unknown; color?: unknown };
    res.status(201).json(await prisma.dashboardNote.create({ data: { text: cleanText(body.text), color: cleanColor(body.color) } }));
  }));

  router.put('/notes/:id', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { text?: unknown; color?: unknown };
    const id = idOf(req);
    const exists = await prisma.dashboardNote.findUnique({ where: { id } });
    if (!exists) throw new ApiError(404, 'Note not found');
    res.json(await prisma.dashboardNote.update({
      where: { id },
      data: { text: cleanText(body.text), color: cleanColor(body.color) },
    }));
  }));

  router.delete('/notes/:id', asyncHandler(async (req, res) => {
    const id = idOf(req);
    const exists = await prisma.dashboardNote.findUnique({ where: { id } });
    if (!exists) throw new ApiError(404, 'Note not found');
    await prisma.dashboardNote.delete({ where: { id } });
    res.status(204).end();
  }));

  return router;
}
