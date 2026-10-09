ALTER TABLE "estimates"
  ALTER COLUMN "jobId" DROP NOT NULL,
  ADD COLUMN "walkInCustomerName" TEXT,
  ADD COLUMN "walkInCustomerAddress" TEXT,
  ADD COLUMN "walkInCustomerPhone" TEXT,
  ADD COLUMN "walkInVehicleYear" INTEGER,
  ADD COLUMN "walkInVehicleMake" TEXT,
  ADD COLUMN "walkInVehicleModel" TEXT,
  ADD COLUMN "walkInVehicleTrim" TEXT,
  ADD COLUMN "walkInVehicleBodyClass" TEXT,
  ADD COLUMN "walkInVehicleVin" TEXT,
  ADD COLUMN "walkInVehicleLicense" TEXT,
  ADD COLUMN "walkInVehicleState" TEXT;
