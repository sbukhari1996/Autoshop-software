-- Storage billing: mark a job as a total loss and record when the car arrived in storage.
ALTER TABLE "jobs"
  ADD COLUMN "totalLoss" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "totalLossDate" TIMESTAMP(3);
