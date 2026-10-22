-- CreateTable
CREATE TABLE "mv104_forms" (
    "id" TEXT NOT NULL,
    "claimId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "input" TEXT NOT NULL,
    "signerName" TEXT,
    "signerEmail" TEXT,
    "documensoEnvelopeId" TEXT,
    "documensoStatus" TEXT,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mv104_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mv104_forms_documensoEnvelopeId_key" ON "mv104_forms"("documensoEnvelopeId");

-- CreateIndex
CREATE INDEX "mv104_forms_claimId_idx" ON "mv104_forms"("claimId");
