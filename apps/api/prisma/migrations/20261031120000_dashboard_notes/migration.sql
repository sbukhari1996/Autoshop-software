-- CreateTable
CREATE TABLE "dashboard_notes" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'yellow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_notes_pkey" PRIMARY KEY ("id")
);
