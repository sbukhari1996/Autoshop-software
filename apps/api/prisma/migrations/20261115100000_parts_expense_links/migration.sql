-- AlterTable
ALTER TABLE "job_parts" ADD COLUMN "cost" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN "partId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "job_expenses_partId_key" ON "job_expenses"("partId");
