-- AlterTable
ALTER TABLE "employees" ADD COLUMN "ssnLast4" TEXT,
ADD COLUMN "federalFilingStatus" TEXT,
ADD COLUMN "w4Step2Checked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "w4DependentsCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "w4OtherIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "w4Deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "w4ExtraWithholding" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "nysAllowances" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nysAdditionalWithholding" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "nycResident" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tax_settings" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_settings_year_key_key" ON "tax_settings"("year", "key");
