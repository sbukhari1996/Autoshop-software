-- AlterTable
ALTER TABLE "finance_entries" ADD COLUMN "customerId" TEXT, ADD COLUMN "vehicleId" TEXT;

-- CreateIndex
CREATE INDEX "finance_entries_customerId_idx" ON "finance_entries"("customerId");

-- CreateIndex
CREATE INDEX "finance_entries_vehicleId_idx" ON "finance_entries"("vehicleId");

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
