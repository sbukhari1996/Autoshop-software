ALTER TABLE "invoices" ALTER COLUMN "customerId" DROP NOT NULL;

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_customerId_fkey";

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
