-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "thumbnailSelectionBreakdown" JSONB,
ADD COLUMN     "thumbnailSelectionFallback" TEXT,
ADD COLUMN     "thumbnailSelectionReason" TEXT,
ADD COLUMN     "thumbnailSelectionTimestamp" DOUBLE PRECISION;
