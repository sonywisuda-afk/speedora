-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "outroEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brandOutroImageDurationSeconds" DOUBLE PRECISION,
ADD COLUMN     "brandOutroType" TEXT,
ADD COLUMN     "brandOutroUrl" TEXT;
