-- CreateTable
CREATE TABLE "claim_follow_ups" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "followedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextFollowUpAt" TIMESTAMP(3),

    CONSTRAINT "claim_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_follow_ups_claimId_idx" ON "claim_follow_ups"("claimId");

-- AddForeignKey
ALTER TABLE "claim_follow_ups" ADD CONSTRAINT "claim_follow_ups_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
