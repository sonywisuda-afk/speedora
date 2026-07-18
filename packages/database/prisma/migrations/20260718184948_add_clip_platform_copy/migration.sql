-- CreateEnum
CREATE TYPE "ClipPlatformCopyStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ClipPlatformCopy" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "ClipPlatformCopyStatus" NOT NULL DEFAULT 'PENDING',
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipPlatformCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipPlatformCopy_clipId_platform_createdAt_idx" ON "ClipPlatformCopy"("clipId", "platform", "createdAt");

-- AddForeignKey
ALTER TABLE "ClipPlatformCopy" ADD CONSTRAINT "ClipPlatformCopy_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
