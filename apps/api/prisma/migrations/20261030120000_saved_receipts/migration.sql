-- CreateTable
CREATE TABLE "saved_receipts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "vehicleLabel" TEXT,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_receipts_kind_idx" ON "saved_receipts"("kind");
