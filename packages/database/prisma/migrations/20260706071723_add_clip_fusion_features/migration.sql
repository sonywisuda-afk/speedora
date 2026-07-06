-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "audioFeatures" JSONB,
ADD COLUMN     "facialFeatures" JSONB,
ADD COLUMN     "sceneFeatures" JSONB;
