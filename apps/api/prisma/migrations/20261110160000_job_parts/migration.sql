-- CreateTable
CREATE TABLE "job_parts" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "partNumber" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'not_ordered',
    "vendorName" TEXT,
    "vendorPhone" TEXT,
    "poNumber" TEXT,
    "quoteNumber" TEXT,
    "invoiceNumber" TEXT,
    "expectedDate" TIMESTAMP(3),
    "arrivedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_parts_jobId_idx" ON "job_parts"("jobId");

-- CreateIndex
CREATE INDEX "job_parts_expectedDate_idx" ON "job_parts"("expectedDate");

-- AddForeignKey
ALTER TABLE "job_parts" ADD CONSTRAINT "job_parts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
