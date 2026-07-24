-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SYNC_FAILURE_WARNING';

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "consecutiveSyncFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSyncFailureAt" TIMESTAMP(3);
