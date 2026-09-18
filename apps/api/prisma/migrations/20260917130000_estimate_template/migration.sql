-- Forward-only repair for the original local bootstrap plus estimate template fields.
ALTER TABLE "estimates" ADD COLUMN "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 8.875;
ALTER TABLE "estimates" ADD COLUMN "damageSummary" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "section" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "operation" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "partNumber" TEXT;
ALTER TABLE "estimate_line_items" ADD COLUMN "paintHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "vehicles_customerId_idx" ON "vehicles"("customerId");
CREATE INDEX "claims_customerId_idx" ON "claims"("customerId");
CREATE INDEX "claims_vehicleId_idx" ON "claims"("vehicleId");
CREATE INDEX "jobs_customerId_idx" ON "jobs"("customerId");
CREATE INDEX "jobs_vehicleId_idx" ON "jobs"("vehicleId");
CREATE INDEX "jobs_claimId_idx" ON "jobs"("claimId");
CREATE INDEX "estimates_jobId_idx" ON "estimates"("jobId");
CREATE INDEX "estimate_line_items_estimateId_idx" ON "estimate_line_items"("estimateId");
CREATE INDEX "inspections_jobId_idx" ON "inspections"("jobId");
CREATE INDEX "job_expenses_jobId_idx" ON "job_expenses"("jobId");
CREATE INDEX "claim_documents_claimId_idx" ON "claim_documents"("claimId");
CREATE INDEX "job_documents_jobId_idx" ON "job_documents"("jobId");
