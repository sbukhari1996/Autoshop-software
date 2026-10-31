-- CreateTable
CREATE TABLE "rental_cars" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vin" TEXT,
    "licensePlate" TEXT,
    "licenseState" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "color" TEXT,
    "dailyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'available',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_cars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_agreements" (
    "id" TEXT NOT NULL,
    "agreementNumber" TEXT NOT NULL,
    "rentalCarId" TEXT NOT NULL,
    "claimId" TEXT,
    "customerId" TEXT,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "customerAddress" TEXT,
    "insuranceCompany" TEXT,
    "claimNumber" TEXT,
    "adjusterName" TEXT,
    "adjusterPhone" TEXT,
    "adjusterEmail" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "dailyRate" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mileageOut" INTEGER,
    "mileageIn" INTEGER,
    "fuelOut" TEXT,
    "fuelIn" TEXT,
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    "damageNotes" TEXT,
    "notes" TEXT,
    "documensoEnvelopeId" TEXT,
    "documensoStatus" TEXT,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_agreements_agreementNumber_key" ON "rental_agreements"("agreementNumber");
CREATE UNIQUE INDEX "rental_agreements_invoiceId_key" ON "rental_agreements"("invoiceId");
CREATE UNIQUE INDEX "rental_agreements_documensoEnvelopeId_key" ON "rental_agreements"("documensoEnvelopeId");
CREATE INDEX "rental_agreements_claimId_idx" ON "rental_agreements"("claimId");
CREATE INDEX "rental_agreements_rentalCarId_idx" ON "rental_agreements"("rentalCarId");

-- AddForeignKey
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_rentalCarId_fkey" FOREIGN KEY ("rentalCarId") REFERENCES "rental_cars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
