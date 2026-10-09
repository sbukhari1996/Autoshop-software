CREATE TABLE "recurring_expense_payments" (
    "id" TEXT NOT NULL,
    "recurringExpenseId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_expense_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_expense_payments_recurringExpenseId_period_key"
ON "recurring_expense_payments"("recurringExpenseId", "period");

CREATE INDEX "recurring_expense_payments_period_idx"
ON "recurring_expense_payments"("period");

ALTER TABLE "recurring_expense_payments"
ADD CONSTRAINT "recurring_expense_payments_recurringExpenseId_fkey"
FOREIGN KEY ("recurringExpenseId") REFERENCES "recurring_expenses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
