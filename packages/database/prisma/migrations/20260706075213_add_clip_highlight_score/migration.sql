-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "highlightBreakdown" JSONB,
ADD COLUMN     "highlightReason" TEXT,
ADD COLUMN     "highlightScore" DOUBLE PRECISION;
