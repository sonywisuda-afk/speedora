-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "highlightConfidence" DOUBLE PRECISION,
ADD COLUMN     "highlightExplainability" JSONB,
ADD COLUMN     "highlightRank" INTEGER;
