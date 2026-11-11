-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "insurancePaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "cashPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "closedAt" TIMESTAMP(3);

-- Jobs already completed or cancelled before this change: use their last update as the close date.
UPDATE "jobs" SET "closedAt" = "updatedAt" WHERE "status" IN ('completed', 'cancelled') AND "closedAt" IS NULL;
