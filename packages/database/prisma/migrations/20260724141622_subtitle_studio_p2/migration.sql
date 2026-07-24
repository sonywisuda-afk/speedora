-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "captionLanguage" TEXT,
ADD COLUMN     "speakerColorCaptions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TranscriptSegment" ADD COLUMN     "translations" JSONB;
