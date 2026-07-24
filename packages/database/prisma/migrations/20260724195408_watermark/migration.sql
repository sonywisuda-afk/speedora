-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "watermarkEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brandWatermarkMargin" DOUBLE PRECISION,
ADD COLUMN     "brandWatermarkOpacity" DOUBLE PRECISION,
ADD COLUMN     "brandWatermarkPosition" TEXT,
ADD COLUMN     "brandWatermarkScale" DOUBLE PRECISION,
ADD COLUMN     "brandWatermarkUrl" TEXT;
