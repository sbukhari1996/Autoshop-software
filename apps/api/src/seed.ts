import { PrismaClient } from '@prisma/client';
import { hashPassword } from './auth.js';

export async function ensureDefaultAdmin(prisma: PrismaClient) {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEFAULT_ADMIN !== 'true') return;
  const email = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@mastercraftautony.com').toLowerCase();
  // The hardcoded password is a local-development convenience only. Production must supply its own.
  const password = process.env.DEFAULT_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Mastercraft2026!');
  if (!password) {
    console.warn('Default admin skipped: set DEFAULT_ADMIN_PASSWORD to create it');
    return;
  }
  const name = process.env.DEFAULT_ADMIN_NAME || 'Mastercraft Admin';
  const organization = await prisma.organization.upsert({ where: { slug: 'mastercraft-auto-repair-collision' }, update: { name: 'Mastercraft Auto Repair & Collision' }, create: { name: 'Mastercraft Auto Repair & Collision', slug: 'mastercraft-auto-repair-collision' } });
  const user = await prisma.user.upsert({ where: { email }, update: { name, role: 'admin' }, create: { email, name, password: await hashPassword(password), role: 'admin' } });
  await prisma.organizationMembership.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, update: { role: 'owner' }, create: { organizationId: organization.id, userId: user.id, role: 'owner' } });
}