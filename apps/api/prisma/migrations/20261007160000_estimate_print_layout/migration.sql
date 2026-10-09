ALTER TABLE "estimates" ADD COLUMN "appraisalCompanyName" TEXT;
ALTER TABLE "estimates" ADD COLUMN "workfileId" TEXT;
ALTER TABLE "estimates" ADD COLUMN "interiorColor" TEXT;
ALTER TABLE "estimates" ADD COLUMN "engine" TEXT;
ALTER TABLE "estimates" ADD COLUMN "productionDate" TEXT;
ALTER TABLE "estimates" ADD COLUMN "vehicleFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "estimate_line_items" ADD COLUMN "note" TEXT;
