-- CreateTable
CREATE TABLE "SocialAccountFollowerSnapshot" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followerCount" INTEGER NOT NULL,

    CONSTRAINT "SocialAccountFollowerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccountFollowerSnapshot_socialAccountId_capturedAt_idx" ON "SocialAccountFollowerSnapshot"("socialAccountId", "capturedAt");

-- AddForeignKey
ALTER TABLE "SocialAccountFollowerSnapshot" ADD CONSTRAINT "SocialAccountFollowerSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
