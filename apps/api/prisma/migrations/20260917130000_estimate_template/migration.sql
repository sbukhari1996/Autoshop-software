-- Forward-only repair for the original local bootstrap plus estimate template fields.
ALTER TABLE "estimates" ADD COLUMN "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 8.875;
ALTER TABLE "estimates" ADD COLUMN "damageSummary" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "section" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "operation" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "partNumber" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "paintHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "vehicles_customerId_idx" ON "vehicles"("customerId");
CREATE INDEX IF NOT EXISTS "claims_customerId_idx" ON "claims"("customerId");
CREATE INDEX IF NOT EXISTS "claims_vehicleId_idx" ON "claims"("vehicleId");
CREATE INDEX IF NOT EXISTS "jobs_customerId_idx" ON "jobs"("customerId");
CREATE INDEX IF NOT EXISTS "jobs_vehicleId_idx" ON "jobs"("vehicleId");
CREATE INDEX IF NOT EXISTS "jobs_claimId_idx" ON "jobs"("claimId");
CREATE INDEX IF NOT EXISTS "estimates_jobId_idx" ON "estimates"("jobId");
CREATE INDEX IF NOT EXISTS "estimate_line_items_estimateId_idx" ON "estimate_line_items"("estimateId");
CREATE INDEX IF NOT EXISTS "inspections_jobId_idx" ON "inspections"("jobId");
CREATE INDEX IF NOT EXISTS "job_expenses_jobId_idx" ON "job_expenses"("jobId");
CREATE INDEX IF NOT EXISTS "claim_documents_claimId_idx" ON "claim_documents"("claimId");
CREATE INDEX IF NOT EXISTS "job_documents_jobId_idx" ON "job_documents"("jobId");
