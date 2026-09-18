import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { hashPassword, requireAuth, signToken, verifyPassword, type AuthUser } from '../auth.js';
import { requiredText } from '../validation.js';

export function createAuthRouter(prisma: PrismaClient) {
  const router = Router();

  router.post('/register', asyncHandler(async (req, res) => {
    const email = requiredText(req.body.email, 'email').toLowerCase();
    const name = requiredText(req.body.name, 'name');
    const password = requiredText(req.body.password, 'password');
    if (password.length < 8) throw new ApiError(400, 'password must be at least 8 characters');
    const user = await prisma.user.create({ data: { email, name, password: await hashPassword(password) } });
    res.status(201).json({ user: publicUser(user), token: signToken({ sub: user.id, email: user.email, role: user.role }) });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const email = requiredText(req.body.email, 'email').toLowerCase();
    const password = requiredText(req.body.password, 'password');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.password))) throw new ApiError(401, 'Invalid email or password');
    res.json({ user: publicUser(user), token: signToken({ sub: user.id, email: user.email, role: user.role }) });
  }));

  router.get('/session', requireAuth, asyncHandler(async (_req, res) => {
    const authUser = res.locals.user as AuthUser;
    const user = await prisma.user.findUnique({ where: { id: authUser.sub } });
    if (!user) throw new ApiError(401, 'Authentication required');
    const memberships = await prisma.organizationMembership.findMany({ where: { userId: user.id }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
    const active = memberships.find((membership) => membership.organizationId === authUser.organizationId) || memberships[0];
    res.json({ user: publicUser(user), organizations: memberships.map(({ organization, role }) => ({ ...organization, role })), activeOrganization: active ? { ...active.organization, role: active.role } : null, activeRole: active?.role || null });
  }));

  router.post('/organizations', requireAuth, asyncHandler(async (req, res) => {
    const authUser = res.locals.user as AuthUser;
    const name = requiredText(req.body.name, 'name');
    const slug = (String(req.body.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization');
    const organization = await prisma.organization.create({ data: { name, slug, memberships: { create: { userId: authUser.sub, role: 'owner' } } }, include: { memberships: true } });
    const membership = organization.memberships[0];
    res.status(201).json({ organization: { id: organization.id, name: organization.name, slug: organization.slug }, membership: { role: membership.role }, token: signToken({ sub: authUser.sub, email: authUser.email, role: membership.role, organizationId: organization.id }) });
  }));

  router.post('/organizations/:organizationId/select', requireAuth, asyncHandler(async (req, res) => {
    const authUser = res.locals.user as AuthUser;
    const organizationId = requiredText(req.params.organizationId, 'organizationId');
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: authUser.sub } }, include: { organization: true } });
    if (!membership) throw new ApiError(403, 'You are not a member of this organization');
    res.json({ organization: { id: membership.organization.id, name: membership.organization.name, slug: membership.organization.slug }, role: membership.role, token: signToken({ sub: authUser.sub, email: authUser.email, role: membership.role, organizationId }) });
  }));

  router.get('/google/status', (_req, res) => {
    const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
    res.json({ configured, provider: 'google', message: configured ? 'Google OAuth is configured' : 'Google OAuth credentials are required' });
  });

  router.get('/google/redirect', (_req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
      res.status(501).json({ error: 'Google OAuth configuration required' });
      return;
    }
    res.status(501).json({ error: 'Google OAuth callback is not enabled yet' });
  });

  router.get('/google/callback', (_req, res) => {
    res.status(501).json({ error: 'Google OAuth callback is not enabled yet' });
  });

  return router;
}

function publicUser(user: { id: string; email: string; name: string; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}