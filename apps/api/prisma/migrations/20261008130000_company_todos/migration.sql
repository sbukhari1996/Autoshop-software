CREATE TABLE "company_todos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_todos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_todos_organizationId_completed_dueDate_idx"
    ON "company_todos"("organizationId", "completed", "dueDate");

ALTER TABLE "company_todos"
    ADD CONSTRAINT "company_todos_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
