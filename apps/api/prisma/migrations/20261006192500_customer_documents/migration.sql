CREATE TABLE "customer_documents" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "documentType" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_documents_customerId_idx" ON "customer_documents"("customerId");

ALTER TABLE "customer_documents"
ADD CONSTRAINT "customer_documents_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
