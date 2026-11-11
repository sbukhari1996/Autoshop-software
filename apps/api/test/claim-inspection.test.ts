import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PrismaClient, type Prisma } from '@prisma/client';
import { clearInspectionVisit, syncClaimInspection, syncInspectionClaim } from '../src/claimInspection.js';

const claim = {
  id: 'claim-1', customerId: 'customer-1',
  adjusterVisitAt: new Date('2026-11-03T15:00:00Z'),
  adjusterName: 'Inspector', adjusterPhone: '555-0100', insuranceCompany: 'Geico',
};
const existing = {
  id: 'inspection-1', claimId: claim.id, customerId: claim.customerId, jobId: null,
  scheduledFor: claim.adjusterVisitAt, inspectorName: 'Old name', inspectorPhone: null,
  insuranceRep: null, status: 'scheduled', notes: 'Keep this note',
  createdAt: new Date(), updatedAt: new Date(),
};

function fixture(t: TestContext, scheduled: typeof existing | null = null, history: typeof existing | null = null) {
  const find = t.mock.fn(async ({ args }: { args: Prisma.InspectionFindFirstArgs }) =>
    args.where?.status === 'scheduled' ? scheduled : history);
  const create = t.mock.fn(async ({ args }: { args: Prisma.InspectionCreateArgs }) => ({ ...existing, ...args.data }));
  const update = t.mock.fn(async ({ args }: { args: Prisma.InspectionUpdateArgs }) => ({ ...existing, ...args.data }));
  const claimUpdate = t.mock.fn(async ({ args }: { args: Prisma.ClaimUpdateArgs }) => args.data);
  const claimClear = t.mock.fn(async ({ args }: { args: Prisma.ClaimUpdateManyArgs }) => ({ count: 1 }));
  const prisma = new PrismaClient().$extends({
    query: {
      inspection: { findFirst: find, create, update },
      claim: { update: claimUpdate, updateMany: claimClear },
    },
  });
  return { prisma, find, create, update, claimUpdate, claimClear };
}

test('creates a linked inspection with the claim visit and adjuster details', async (t) => {
  const { prisma, create } = fixture(t);
  await syncClaimInspection(prisma, claim);
  assert.deepEqual(create.mock.calls[0].arguments[0].args.data, {
    customerId: claim.customerId, claimId: claim.id, scheduledFor: claim.adjusterVisitAt,
    inspectorName: claim.adjusterName, inspectorPhone: claim.adjusterPhone,
    insuranceRep: claim.insuranceCompany, status: 'scheduled',
  });
});

test('repeated saves update a scheduled event without duplicates or changing notes', async (t) => {
  const { prisma, find, update, create } = fixture(t, existing);
  const changed = { ...claim, adjusterVisitAt: new Date('2026-11-04T17:00:00Z'), adjusterName: 'New inspector' };
  await syncClaimInspection(prisma, changed);
  await syncClaimInspection(prisma, changed);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 2);
  assert.deepEqual(find.mock.calls[0].arguments[0].args, {
    where: { claimId: claim.id, status: 'scheduled' }, orderBy: { scheduledFor: 'asc' },
  });
  const args = update.mock.calls[0].arguments[0].args;
  assert.equal(args.where.id, existing.id);
  assert.equal(args.data.inspectorName, 'New inspector');
  assert.deepEqual(args.data.scheduledFor, changed.adjusterVisitAt);
  assert.equal('notes' in args.data, false);
});

test('does not create an appointment without a visit date', async (t) => {
  const { prisma, create } = fixture(t);
  await syncClaimInspection(prisma, { ...claim, adjusterVisitAt: null });
  assert.equal(create.mock.callCount(), 0);
});

test('clearing a matching claim visit cancels its scheduled inspection', async (t) => {
  const { prisma, update } = fixture(t, existing);
  await syncClaimInspection(prisma, { ...claim, adjusterVisitAt: null }, claim.adjusterVisitAt);
  assert.deepEqual(update.mock.calls[0].arguments[0].args, { where: { id: existing.id }, data: { status: 'cancelled' } });
});

test('inspector details update a manual event without clearing its date', async (t) => {
  const { prisma, update } = fixture(t, existing);
  await syncClaimInspection(prisma, { ...claim, adjusterVisitAt: null, adjusterName: 'New inspector' });
  const data = update.mock.calls[0].arguments[0].args.data;
  assert.equal(data.inspectorName, 'New inspector');
  assert.equal('scheduledFor' in data, false);
  assert.equal('status' in data, false);
});

test('completed and cancelled history is not recreated on claim save', async (t) => {
  for (const status of ['completed', 'cancelled']) {
    const { prisma, create } = fixture(t, null, { ...existing, status });
    await syncClaimInspection(prisma, claim);
    assert.equal(create.mock.callCount(), 0);
  }
});

test('rescheduling updates the linked claim, while completion clears only the matching visit', async (t) => {
  const { prisma, claimUpdate, claimClear } = fixture(t);
  await syncInspectionClaim(prisma, existing);
  assert.deepEqual(claimUpdate.mock.calls[0].arguments[0].args, {
    where: { id: claim.id },
    data: { adjusterVisitAt: existing.scheduledFor, adjusterName: existing.inspectorName,
      adjusterPhone: existing.inspectorPhone, insuranceCompany: existing.insuranceRep },
  });
  await syncInspectionClaim(prisma, { ...existing, status: 'completed' });
  assert.deepEqual(claimClear.mock.calls[0].arguments[0].args, {
    where: { id: claim.id, adjusterVisitAt: existing.scheduledFor },
    data: { adjusterVisitAt: null },
  });
});

test('deleting an event clears its matching visit; unlinked events do not change claims', async (t) => {
  const { prisma, claimUpdate, claimClear } = fixture(t);
  await clearInspectionVisit(prisma, existing);
  assert.equal(claimClear.mock.callCount(), 1);
  await syncInspectionClaim(prisma, { ...existing, claimId: null });
  await clearInspectionVisit(prisma, { ...existing, claimId: null });
  assert.equal(claimUpdate.mock.callCount(), 0);
  assert.equal(claimClear.mock.callCount(), 1);
});
