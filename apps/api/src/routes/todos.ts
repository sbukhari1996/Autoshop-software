import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { requireAuth, type AuthUser } from '../auth.js';
import { optionalBoolean, requiredText } from '../validation.js';

export function createTodosRouter(prisma: PrismaClient) {
  const router = Router();

  router.use(requireAuth, asyncHandler(async (_req, res, next) => {
    const user = res.locals.user as AuthUser;
    const membership = res.locals.membership || await prisma.organizationMembership.findFirst({
      where: {
        userId: user.sub,
        ...(user.organizationId ? { organizationId: user.organizationId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ApiError(403, 'An active organization membership is required');
    res.locals.membership = membership;
    next();
  }));

  router.get('/', asyncHandler(async (_req, res) => {
    const membership = res.locals.membership as { organizationId: string };
    const todos = await prisma.companyTodo.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    res.json(todos);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const membership = res.locals.membership as { organizationId: string };
    const title = requiredText(req.body.title, 'title');
    const dueDate = parseDueDate(req.body.dueDate);
    const todo = await prisma.companyTodo.create({
      data: { organizationId: membership.organizationId, title, dueDate },
    });
    res.status(201).json(todo);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const membership = res.locals.membership as { organizationId: string };
    const id = requiredText(req.params.id, 'id');
    const existing = await prisma.companyTodo.findFirst({
      where: { id, organizationId: membership.organizationId },
      select: { id: true, completed: true },
    });
    if (!existing) throw new ApiError(404, 'Task not found');

    const completed = req.body.completed === undefined
      ? undefined
      : optionalBoolean(req.body.completed, 'completed');
    const todo = await prisma.companyTodo.update({
      where: { id },
      data: {
        title: req.body.title === undefined ? undefined : requiredText(req.body.title, 'title'),
        dueDate: req.body.dueDate === undefined ? undefined : parseDueDate(req.body.dueDate),
        completed,
        completedAt: completed === undefined ? undefined : completed ? new Date() : null,
      },
    });
    res.json(todo);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const membership = res.locals.membership as { organizationId: string };
    const result = await prisma.companyTodo.deleteMany({
      where: { id: requiredText(req.params.id, 'id'), organizationId: membership.organizationId },
    });
    if (!result.count) throw new ApiError(404, 'Task not found');
    res.status(204).send();
  }));

  return router;
}

function parseDueDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, 'dueDate must be a valid date');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'dueDate must be a valid date');
  }
  return parsed;
}
