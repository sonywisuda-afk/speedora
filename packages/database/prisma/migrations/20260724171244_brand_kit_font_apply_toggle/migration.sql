-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "applyBrandKit" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brandFontFamily" TEXT;
