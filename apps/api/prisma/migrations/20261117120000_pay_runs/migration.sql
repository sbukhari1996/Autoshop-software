-- CreateTable
CREATE TABLE "pay_runs" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "grossPay" DOUBLE PRECISION NOT NULL,
    "federalWithholding" DOUBLE PRECISION NOT NULL,
    "nysWithholding" DOUBLE PRECISION NOT NULL,
    "nycWithholding" DOUBLE PRECISION NOT NULL,
    "socialSecurityEmployee" DOUBLE PRECISION NOT NULL,
    "medicareEmployee" DOUBLE PRECISION NOT NULL,
    "sdiEmployee" DOUBLE PRECISION NOT NULL,
    "pflEmployee" DOUBLE PRECISION NOT NULL,
    "netPay" DOUBLE PRECISION NOT NULL,
    "socialSecurityEmployer" DOUBLE PRECISION NOT NULL,
    "medicareEmployer" DOUBLE PRECISION NOT NULL,
    "futaEmployer" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pay_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pay_runs_employeeId_payDate_idx" ON "pay_runs"("employeeId", "payDate");

-- AddForeignKey
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
