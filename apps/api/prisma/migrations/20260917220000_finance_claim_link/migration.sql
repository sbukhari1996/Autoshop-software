ALTER TABLE "finance_entries" ADD COLUMN "claimId" TEXT;
CREATE INDEX "finance_entries_claimId_idx" ON "finance_entries"("claimId");
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
