-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "introEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brandIntroImageDurationSeconds" DOUBLE PRECISION,
ADD COLUMN     "brandIntroType" TEXT,
ADD COLUMN     "brandIntroUrl" TEXT;
