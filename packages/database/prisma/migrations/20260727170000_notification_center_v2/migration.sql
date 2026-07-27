-- Notification Center v2 - squashed migration representing the final,
-- shipped state of all 5 phases (Database Foundation, Notification Engine,
-- API Layer, Realtime/Frontend, Preferences & Delivery). Replaces what was
-- previously 6 separate, never-deployed-beyond-local-dev migrations that
-- included self-cancelling churn (e.g. adding then dropping groupKey/
-- occurrenceCount/lastOccurredAt in favor of the NotificationThread/
-- NotificationGroup FK design). None of those 6 migrations were ever applied
-- to a shared/production database, so squashing them into one clean
-- migration is safe and does not rewrite any deployed history.

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('UPLOAD', 'AI_PROCESSING', 'CLIP_GENERATION', 'RENDERING', 'PUBLISHING', 'ANALYTICS', 'BILLING', 'WORKSPACE', 'SYSTEM', 'ERRORS');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationThreadStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'EMAIL';
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';
ALTER TYPE "NotificationChannel" ADD VALUE 'DESKTOP';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_PROGRESS';

-- AlterTable
-- category/priority/updatedAt start nullable-or-defaulted so any
-- pre-existing Notification row can be backfilled below, then locked to
-- their final NOT NULL (updatedAt: NOT NULL with no DB default, matching
-- Prisma's @updatedAt - every write goes through Prisma Client, which
-- always supplies it).
ALTER TABLE "Notification" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "category" "NotificationCategory",
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "priority" "NotificationPriority",
ADD COLUMN     "threadId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: category/priority for every pre-existing row, keyed on the
-- existing `type` column per the Notification Center v2 plan's mapping
-- table. packages/database/src/notification.ts's
-- NOTIFICATION_TYPE_CATEGORY/NOTIFICATION_TYPE_PRIORITY are the runtime
-- source of truth for every write going forward - this is a one-time
-- historical backfill only.
UPDATE "Notification" SET "category" = (CASE "type"::text
  WHEN 'UPLOAD_COMPLETE' THEN 'UPLOAD'
  WHEN 'CLIP_READY' THEN 'CLIP_GENERATION'
  WHEN 'EXPORT_READY' THEN 'RENDERING'
  WHEN 'RENDER_FAILED' THEN 'ERRORS'
  WHEN 'STORAGE_WARNING' THEN 'SYSTEM'
  WHEN 'CREDIT_WARNING' THEN 'BILLING'
  WHEN 'SYNC_FAILURE_WARNING' THEN 'PUBLISHING'
  WHEN 'COMMENT' THEN 'WORKSPACE'
  WHEN 'MENTION' THEN 'WORKSPACE'
  WHEN 'REVIEW_REQUEST' THEN 'WORKSPACE'
  WHEN 'APPROVAL' THEN 'WORKSPACE'
  WHEN 'MEMBER_INVITATION_ACCEPTED' THEN 'WORKSPACE'
END)::"NotificationCategory";

UPDATE "Notification" SET "priority" = (CASE "type"::text
  WHEN 'UPLOAD_COMPLETE' THEN 'INFO'
  WHEN 'CLIP_READY' THEN 'SUCCESS'
  WHEN 'EXPORT_READY' THEN 'SUCCESS'
  WHEN 'RENDER_FAILED' THEN 'ERROR'
  WHEN 'STORAGE_WARNING' THEN 'WARNING'
  WHEN 'CREDIT_WARNING' THEN 'WARNING'
  WHEN 'SYNC_FAILURE_WARNING' THEN 'WARNING'
  WHEN 'COMMENT' THEN 'INFO'
  WHEN 'MENTION' THEN 'INFO'
  WHEN 'REVIEW_REQUEST' THEN 'INFO'
  WHEN 'APPROVAL' THEN 'SUCCESS'
  WHEN 'MEMBER_INVITATION_ACCEPTED' THEN 'SUCCESS'
END)::"NotificationPriority";

ALTER TABLE "Notification" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "priority" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationWebhook" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "NotificationThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "videoId" TEXT,
    "title" TEXT NOT NULL,
    "status" "NotificationThreadStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationReadReceipt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationReadReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCategoryPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCategoryPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationThread_userId_archivedAt_lastActivityAt_idx" ON "NotificationThread"("userId", "archivedAt", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationThread_userId_key_key" ON "NotificationThread"("userId", "key");

-- CreateIndex
CREATE INDEX "NotificationGroup_userId_archivedAt_lastOccurredAt_idx" ON "NotificationGroup"("userId", "archivedAt", "lastOccurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationGroup_userId_key_key" ON "NotificationGroup"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationReadReceipt_notificationId_userId_key" ON "NotificationReadReceipt"("notificationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCategoryPreference_userId_category_channel_key" ON "NotificationCategoryPreference"("userId", "category", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId", "channel");

-- CreateIndex
CREATE INDEX "Notification_userId_archivedAt_createdAt_idx" ON "Notification"("userId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_archivedAt_updatedAt_idx" ON "Notification"("userId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_threadId_key" ON "Notification"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_groupId_key" ON "Notification"("groupId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "NotificationThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "NotificationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationThread" ADD CONSTRAINT "NotificationThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationGroup" ADD CONSTRAINT "NotificationGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationReadReceipt" ADD CONSTRAINT "NotificationReadReceipt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationReadReceipt" ADD CONSTRAINT "NotificationReadReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCategoryPreference" ADD CONSTRAINT "NotificationCategoryPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
