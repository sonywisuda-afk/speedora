-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "fontFamily" TEXT;

-- CreateTable
CREATE TABLE "SubtitlePreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "captionStyle" "CaptionStyle" NOT NULL DEFAULT 'DEFAULT',
    "speakerColorCaptions" BOOLEAN NOT NULL DEFAULT false,
    "fontFamily" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubtitlePreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubtitlePreset_userId_idx" ON "SubtitlePreset"("userId");

-- AddForeignKey
ALTER TABLE "SubtitlePreset" ADD CONSTRAINT "SubtitlePreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
