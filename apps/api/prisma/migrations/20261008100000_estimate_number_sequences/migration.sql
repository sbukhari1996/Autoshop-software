CREATE SEQUENCE "estimate_number_seq" START WITH 1;
CREATE SEQUENCE "workfile_id_seq" START WITH 1;

SELECT setval(
  'estimate_number_seq',
  COALESCE(MAX(substring("estimateNumber" FROM '[0-9]+$')::bigint), 1),
  COUNT("estimateNumber") > 0
)
FROM "estimates"
WHERE "estimateNumber" ~ '[0-9]+$';

SELECT setval(
  'workfile_id_seq',
  COALESCE(MAX(substring("workfileId" FROM '[0-9]+$')::bigint), 1),
  COUNT("workfileId") > 0
)
FROM "estimates"
WHERE "workfileId" ~ '[0-9]+$';

CREATE UNIQUE INDEX "estimates_estimateNumber_key" ON "estimates"("estimateNumber");
CREATE UNIQUE INDEX "estimates_workfileId_key" ON "estimates"("workfileId");
