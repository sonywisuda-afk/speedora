-- CreateEnum
CREATE TYPE "ActivityDeletionAction" AS ENUM ('DELETE_SELECTED', 'DELETE_ALL');

-- AlterTable
ALTER TABLE "ActivityEvent" ADD COLUMN     "description" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "ActivityDeletionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ActivityDeletionAction" NOT NULL,
    "deletedIds" JSONB,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityDeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityDeletionLog_userId_createdAt_idx" ON "ActivityDeletionLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivityDeletionLog" ADD CONSTRAINT "ActivityDeletionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
