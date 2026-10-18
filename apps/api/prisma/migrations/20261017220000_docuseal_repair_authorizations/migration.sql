ALTER TABLE "repair_authorizations"
  ADD COLUMN "docusealSubmissionId" TEXT,
  ADD COLUMN "docusealSignerEmail" TEXT,
  ADD COLUMN "docusealStatus" TEXT,
  ADD COLUMN "docusealCompletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "repair_authorizations_docusealSubmissionId_key"
  ON "repair_authorizations"("docusealSubmissionId");
