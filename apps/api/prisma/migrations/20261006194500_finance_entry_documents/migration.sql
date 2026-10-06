CREATE TABLE "finance_entry_documents" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_entry_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finance_entry_documents_entryId_idx" ON "finance_entry_documents"("entryId");

ALTER TABLE "finance_entry_documents"
ADD CONSTRAINT "finance_entry_documents_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "finance_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
