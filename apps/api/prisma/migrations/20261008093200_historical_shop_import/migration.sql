ALTER TABLE "vehicles"
ADD COLUMN "registrationDetails" TEXT,
ADD COLUMN "notes" TEXT;

ALTER TABLE "claims"
ADD COLUMN "lossType" TEXT;

ALTER TABLE "customers"
ADD COLUMN "notes" TEXT;

CREATE TABLE "historical_import_records" (
    "sourceKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_import_records_pkey" PRIMARY KEY ("sourceKey")
);

CREATE UNIQUE INDEX "historical_import_records_entityType_recordId_key"
ON "historical_import_records"("entityType", "recordId");

CREATE INDEX "historical_import_records_entityType_idx"
ON "historical_import_records"("entityType");
