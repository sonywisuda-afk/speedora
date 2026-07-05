-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "ctaText" TEXT,
ADD COLUMN     "intent" TEXT,
ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "scores" JSONB,
ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[];
