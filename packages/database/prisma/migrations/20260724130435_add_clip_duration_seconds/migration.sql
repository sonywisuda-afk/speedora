-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "durationSeconds" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Clip_viralityScore_idx" ON "Clip"("viralityScore");

-- CreateIndex
CREATE INDEX "Clip_durationSeconds_idx" ON "Clip"("durationSeconds");
