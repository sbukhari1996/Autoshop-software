-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "agreedAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN "receiptName" TEXT;

-- CreateTable
CREATE TABLE "job_payments" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_payments_jobId_idx" ON "job_payments"("jobId");

-- AddForeignKey
ALTER TABLE "job_payments" ADD CONSTRAINT "job_payments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
