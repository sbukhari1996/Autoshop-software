CREATE TABLE "rental_tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "space" TEXT NOT NULL DEFAULT 'mechanical',
    "shift" TEXT NOT NULL DEFAULT 'day',
    "rentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rentFrequency" TEXT NOT NULL DEFAULT 'daily',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rental_tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rental_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'rent',
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rental_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_payments_sourceReference_key" ON "rental_payments"("sourceReference");
CREATE INDEX "rental_tenants_active_startDate_idx" ON "rental_tenants"("active", "startDate");
CREATE INDEX "rental_payments_tenantId_paymentDate_idx" ON "rental_payments"("tenantId", "paymentDate");
ALTER TABLE "rental_payments" ADD CONSTRAINT "rental_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "rental_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;