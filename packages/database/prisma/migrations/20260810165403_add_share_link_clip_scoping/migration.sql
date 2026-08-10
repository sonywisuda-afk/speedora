-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN     "clipId" TEXT;

-- CreateIndex
CREATE INDEX "ShareLink_clipId_idx" ON "ShareLink"("clipId");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
