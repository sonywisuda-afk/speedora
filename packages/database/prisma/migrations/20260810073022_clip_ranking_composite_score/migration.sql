-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "compositeRank" INTEGER,
ADD COLUMN     "compositeRankConfidence" DOUBLE PRECISION,
ADD COLUMN     "compositeRankScore" DOUBLE PRECISION,
ADD COLUMN     "compositeRankSubScores" JSONB;
