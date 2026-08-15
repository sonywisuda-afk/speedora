-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "renderManifest" JSONB,
ADD COLUMN     "renderPlan" JSONB,
ADD COLUMN     "renderVerification" JSONB;
