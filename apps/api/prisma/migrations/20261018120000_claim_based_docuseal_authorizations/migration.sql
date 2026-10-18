ALTER TABLE "repair_authorizations"
  ALTER COLUMN "jobId" DROP NOT NULL,
  ADD COLUMN "claimId" TEXT;

ALTER TABLE "repair_authorizations"
  DROP CONSTRAINT "repair_authorizations_jobId_fkey";

ALTER TABLE "repair_authorizations"
  ADD CONSTRAINT "repair_authorizations_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "repair_authorizations_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "repair_authorizations_owner_check"
    CHECK ("jobId" IS NOT NULL OR "claimId" IS NOT NULL);

CREATE INDEX "repair_authorizations_claimId_idx"
  ON "repair_authorizations"("claimId");
