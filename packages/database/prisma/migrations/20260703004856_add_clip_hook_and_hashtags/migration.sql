-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hookText" TEXT;
