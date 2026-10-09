ALTER TABLE "estimate_line_items"
ADD COLUMN "parentLineId" TEXT,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "estimate_line_items"
ADD CONSTRAINT "estimate_line_items_parentLineId_fkey"
FOREIGN KEY ("parentLineId") REFERENCES "estimate_line_items"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "estimate_line_items_estimateId_sortOrder_idx"
ON "estimate_line_items"("estimateId", "sortOrder");

CREATE SEQUENCE "job_number_seq" START WITH 1;

SELECT setval(
  'job_number_seq',
  COALESCE(
    (SELECT MAX(SUBSTRING("jobNumber" FROM '^JOB-([0-9]+)$')::BIGINT) FROM "jobs"),
    0
  ) + 1,
  false
);
