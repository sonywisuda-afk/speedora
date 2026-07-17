-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'STORAGE_WARNING';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_WARNING';

-- CreateTable
CREATE TABLE "AlertState" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "activeSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertState_dedupeKey_key" ON "AlertState"("dedupeKey");
