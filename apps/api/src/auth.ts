import { createHmac, randomBytes, pbkdf2, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { promisify } from 'node:util';
import { ApiError } from './errors.js';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { PrismaClient } from '@prisma/client';

const deriveKey = promisify(pbkdf2);
const tokenLifetimeSeconds = 60 * 60 * 24;

type TokenPayload = { sub: string; email: string; role: string; exp: number; organizationId?: string };
const roles = ['owner', 'admin', 'manager', 'technician', 'parts_clerk', 'viewer'] as const;
export type OrganizationRole = typeof roles[number];

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, 120000, 32, 'sha256');
  return `pbkdf2_sha256$120000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, digestText] = stored.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !iterationsText || !saltText || !digestText) return false;
  const derived = await deriveKey(password, Buffer.from(saltText, 'base64url'), Number(iterationsText), 32, 'sha256');
  const expected = Buffer.from(digestText, 'base64url');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function secret() {
  return process.env.AUTH_SECRET || 'local-development-auth-secret-change-me';
}

export function signToken(payload: Omit<TokenPayload, 'exp'>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readToken(token: string): TokenPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

async function readExternalToken(token: string): Promise<TokenPayload | null> {
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL || (process.env.NEON_AUTH_URL ? `${process.env.NEON_AUTH_URL.replace(/\/$/, '')}/.well-known/jwks.json` : '');
  if (!jwksUrl || token.split('.').length !== 3) return null;
  try {
    const keySet = createRemoteJWKSet(new URL(jwksUrl));
    const options = process.env.NEON_AUTH_URL ? { issuer: process.env.NEON_AUTH_URL } : undefined;
    const { payload } = await jwtVerify(token, keySet, options);
    return externalPayload(payload);
  } catch {
    return null;
  }
}

function externalPayload(payload: JWTPayload): TokenPayload | null {
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
  return { sub: payload.sub, email: payload.email, role: typeof payload.role === 'string' ? payload.role : 'viewer', exp: payload.exp || Math.floor(Date.now() / 1000) + tokenLifetimeSeconds };
}

export async function readAuthToken(token: string): Promise<TokenPayload | null> {
  return token.split('.').length === 3 ? readExternalToken(token) : readToken(token);
}

export async function readNeonSession(token: string): Promise<{ id: string; email: string; name: string } | null> {
  const authUrl = process.env.NEON_AUTH_URL?.replace(/\/$/, '');
  if (!authUrl) return null;
  try {
    const response = await fetch(`${authUrl}/get-session`, { headers: { Authorization: `Bearer ${token}`, Cookie: `better-auth.session_token=${token}` } });
    const body = await response.json().catch(() => null) as { user?: { id?: string; email?: string; name?: string }; session?: { user?: { id?: string; email?: string; name?: string } } } | null;
    const user = body?.user || body?.session?.user;
    if (!response.ok || !user?.id || !user.email) return null;
    return { id: String(user.id), email: user.email.toLowerCase(), name: user.name || user.email.split('@')[0] };
  } catch { return null; }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const payload = header?.startsWith('Bearer ') ? await readAuthToken(header.slice(7)) : null;
  if (!payload) return next(new ApiError(401, 'Authentication required'));
  res.locals.user = payload;
  return next();
}

export function requireRole(...allowed: OrganizationRole[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const role = res.locals.membership?.role;
    if (!role || !allowed.includes(role)) return next(new ApiError(403, 'Insufficient organization permissions'));
    return next();
  };
}

export function protectMutations(prisma: PrismaClient) {
  return (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.path === '/health' || req.path.startsWith('/auth')) return next();
    return requireAuth(req, res, () => {
      const authUser = res.locals.user as TokenPayload;
      void prisma.organizationMembership.findFirst({
        where: { userId: authUser.sub, ...(authUser.organizationId ? { organizationId: authUser.organizationId } : {}) },
        orderBy: { createdAt: 'asc' },
      }).then((membership) => {
        if (!membership) return next(new ApiError(403, 'An active organization membership is required'));
        res.locals.membership = membership;
        return next();
      }).catch(next);
    });
  };
}

export type AuthUser = TokenPayload;