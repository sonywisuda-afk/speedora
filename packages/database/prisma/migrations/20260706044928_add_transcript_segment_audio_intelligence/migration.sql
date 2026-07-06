-- AlterTable
ALTER TABLE "TranscriptSegment" ADD COLUMN     "peakDb" DOUBLE PRECISION,
ADD COLUMN     "rmsDb" DOUBLE PRECISION,
ADD COLUMN     "speakingRateWordsPerSecond" DOUBLE PRECISION;
