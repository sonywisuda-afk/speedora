-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "objectFeatures" JSONB,
ADD COLUMN     "objectTracks" JSONB,
ADD COLUMN     "objects" JSONB;
