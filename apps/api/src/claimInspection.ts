import type { Claim, Prisma } from '@prisma/client';

type InspectionClaim = Pick<Claim, 'id' | 'customerId' | 'adjusterVisitAt' | 'adjusterName' | 'adjusterPhone' | 'insuranceCompany'>;

export async function syncClaimInspection(tx: Prisma.TransactionClient, claim: InspectionClaim, previousVisit?: Date | null) {
  const inspection = await tx.inspection.findFirst({
    where: { claimId: claim.id, status: 'scheduled' },
    orderBy: { scheduledFor: 'asc' },
  });
  if (!claim.adjusterVisitAt) {
    if (inspection && previousVisit && inspection.scheduledFor?.getTime() === previousVisit.getTime()) {
      await tx.inspection.update({ where: { id: inspection.id }, data: { status: 'cancelled' } });
    } else if (inspection) {
      await tx.inspection.update({
        where: { id: inspection.id },
        data: { customerId: claim.customerId, inspectorName: claim.adjusterName, inspectorPhone: claim.adjusterPhone, insuranceRep: claim.insuranceCompany },
      });
    }
    return;
  }
  const data = {
    customerId: claim.customerId,
    claimId: claim.id,
    scheduledFor: claim.adjusterVisitAt,
    inspectorName: claim.adjusterName,
    inspectorPhone: claim.adjusterPhone,
    insuranceRep: claim.insuranceCompany,
  };
  if (inspection) {
    await tx.inspection.update({ where: { id: inspection.id }, data });
  } else {
    const history = await tx.inspection.findFirst({
      where: { claimId: claim.id, scheduledFor: claim.adjusterVisitAt, status: { not: 'scheduled' } },
    });
    if (history) return;
    await tx.inspection.create({ data: { ...data, status: 'scheduled' } });
  }
}

export async function syncInspectionClaim(tx: Prisma.TransactionClient, inspection: {
  claimId: string | null; scheduledFor: Date | null; status: string;
  inspectorName: string | null; inspectorPhone: string | null; insuranceRep: string | null;
}) {
  if (!inspection.claimId) return;
  if (inspection.status === 'scheduled') {
    await tx.claim.update({
      where: { id: inspection.claimId },
      data: {
        adjusterVisitAt: inspection.scheduledFor,
        adjusterName: inspection.inspectorName,
        adjusterPhone: inspection.inspectorPhone,
        insuranceCompany: inspection.insuranceRep,
      },
    });
  } else {
    await clearInspectionVisit(tx, inspection);
  }
}

export async function clearInspectionVisit(tx: Prisma.TransactionClient, inspection: { claimId: string | null; scheduledFor: Date | null }) {
  if (!inspection.claimId || !inspection.scheduledFor) return;
  await tx.claim.updateMany({
    where: { id: inspection.claimId, adjusterVisitAt: inspection.scheduledFor },
    data: { adjusterVisitAt: null },
  });
}
