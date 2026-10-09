CREATE SEQUENCE invoice_number_seq START WITH 1;

SELECT setval(
  'invoice_number_seq',
  COALESCE(
    (
      SELECT MAX(substring("invoiceNumber" FROM 5)::bigint)
      FROM "invoices"
      WHERE "invoiceNumber" ~ '^INV-[0-9]+$'
    ),
    0
  ) + 1,
  false
);
