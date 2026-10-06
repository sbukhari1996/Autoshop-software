ALTER TABLE "inspections" ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "inspections" ADD COLUMN "customerId" TEXT;
ALTER TABLE "inspections" ADD COLUMN "claimId" TEXT;

CREATE INDEX "inspections_customerId_idx" ON "inspections"("customerId");
CREATE INDEX "inspections_claimId_idx" ON "inspections"("claimId");

ALTER TABLE "inspections" ADD CONSTRAINT "inspections_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;