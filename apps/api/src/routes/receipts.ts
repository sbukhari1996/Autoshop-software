import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';

const kinds = ['towing', 'storage'];
const maxStateLength = 200_000;

function idOf(req: { params: Record<string, string | string[]> }) {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] : value;
}

function cleanText(value: unknown, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// The receipt's form values as a JSON string, checked for shape and size.
function cleanState(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Receipt values are missing');
  const json = JSON.stringify(value);
  if (json.length > maxStateLength) throw new ApiError(413, 'Receipt is too large to save');
  return json;
}

function summary(row: { id: string; kind: string; title: string; customerName: string | null; vehicleLabel: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: row.id, kind: row.kind, title: row.title, customerName: row.customerName, vehicleLabel: row.vehicleLabel, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function createReceiptsRouter(prisma: PrismaClient) {
  const router = Router();

  const findReceipt = async (id: string) => {
    const row = await prisma.savedReceipt.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, 'Receipt not found');
    return row;
  };

  // All saved towing and storage receipts, newest first. Pass ?kind=towing or ?kind=storage to filter.
  router.get('/receipts', asyncHandler(async (req, res) => {
    const kind = typeof req.query.kind === 'string' && kinds.includes(req.query.kind) ? req.query.kind : undefined;
    const rows = await prisma.savedReceipt.findMany({ where: kind ? { kind } : undefined, orderBy: { updatedAt: 'desc' }, take: 500 });
    res.json(rows.map(summary));
  }));

  router.get('/receipts/:id', asyncHandler(async (req, res) => {
    const row = await findReceipt(idOf(req));
    res.json({ ...summary(row), values: JSON.parse(row.state) });
  }));

  router.post('/receipts', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { kind?: unknown; title?: unknown; customerName?: unknown; vehicleLabel?: unknown; values?: unknown };
    if (typeof body.kind !== 'string' || !kinds.includes(body.kind)) throw new ApiError(400, 'Receipt kind must be towing or storage');
    const row = await prisma.savedReceipt.create({
      data: {
        kind: body.kind,
        title: cleanText(body.title) || `${body.kind === 'towing' ? 'Towing' : 'Storage'} receipt`,
        customerName: cleanText(body.customerName) || null,
        vehicleLabel: cleanText(body.vehicleLabel) || null,
        state: cleanState(body.values),
      },
    });
    res.status(201).json({ ...summary(row), values: JSON.parse(row.state) });
  }));

  // Saves changes to an existing receipt.
  router.put('/receipts/:id', asyncHandler(async (req, res) => {
    const row = await findReceipt(idOf(req));
    const body = (req.body ?? {}) as { title?: unknown; customerName?: unknown; vehicleLabel?: unknown; values?: unknown };
    const updated = await prisma.savedReceipt.update({
      where: { id: row.id },
      data: {
        title: cleanText(body.title) || row.title,
        customerName: body.customerName !== undefined ? cleanText(body.customerName) || null : row.customerName,
        vehicleLabel: body.vehicleLabel !== undefined ? cleanText(body.vehicleLabel) || null : row.vehicleLabel,
        ...(body.values !== undefined ? { state: cleanState(body.values) } : {}),
      },
    });
    res.json({ ...summary(updated), values: JSON.parse(updated.state) });
  }));

  router.delete('/receipts/:id', asyncHandler(async (req, res) => {
    await findReceipt(idOf(req));
    await prisma.savedReceipt.delete({ where: { id: idOf(req) } });
    res.status(204).end();
  }));

  return router;
}
