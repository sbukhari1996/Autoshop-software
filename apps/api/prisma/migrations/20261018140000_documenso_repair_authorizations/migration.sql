ALTER TABLE "repair_authorizations"
  ADD COLUMN "documensoEnvelopeId" TEXT,
  ADD COLUMN "documensoSignerEmail" TEXT,
  ADD COLUMN "documensoStatus" TEXT,
  ADD COLUMN "documensoCompletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "repair_authorizations_documensoEnvelopeId_key"
  ON "repair_authorizations"("documensoEnvelopeId");
