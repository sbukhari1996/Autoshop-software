CREATE TABLE "bank_statements" (
  "id" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "openingBalance" DOUBLE PRECISION,
  "closingBalance" DOUBLE PRECISION,
  "warnings" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "bank_transactions" (
  "id" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "entryDate" TIMESTAMP(3),
  "originalDate" TEXT,
  "description" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "direction" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "category" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "matchedSource" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "_BankStatementToBankTransaction" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);
CREATE UNIQUE INDEX "bank_statements_accountKey_fileHash_key" ON "bank_statements"("accountKey", "fileHash");
CREATE INDEX "bank_statements_periodStart_periodEnd_idx" ON "bank_statements"("periodStart", "periodEnd");
CREATE UNIQUE INDEX "bank_transactions_accountKey_sourceReference_key" ON "bank_transactions"("accountKey", "sourceReference");
CREATE UNIQUE INDEX "bank_transactions_matchedSource_key" ON "bank_transactions"("matchedSource");
CREATE INDEX "bank_transactions_entryDate_idx" ON "bank_transactions"("entryDate");
CREATE UNIQUE INDEX "_BankStatementToBankTransaction_AB_unique" ON "_BankStatementToBankTransaction"("A", "B");
CREATE INDEX "_BankStatementToBankTransaction_B_index" ON "_BankStatementToBankTransaction"("B");
ALTER TABLE "_BankStatementToBankTransaction" ADD CONSTRAINT "_BankStatementToBankTransaction_A_fkey" FOREIGN KEY ("A") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_BankStatementToBankTransaction" ADD CONSTRAINT "_BankStatementToBankTransaction_B_fkey" FOREIGN KEY ("B") REFERENCES "bank_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
