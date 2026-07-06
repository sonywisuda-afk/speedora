-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "highlightPrediction" JSONB,
ADD COLUMN     "highlightRecommendation" JSONB,
ADD COLUMN     "llmFeatures" JSONB;
