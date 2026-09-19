CREATE TABLE "invoice_documents" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "documentType" TEXT NOT NULL DEFAULT 'receipt',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_documents_invoiceId_idx" ON "invoice_documents"("invoiceId");

ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
