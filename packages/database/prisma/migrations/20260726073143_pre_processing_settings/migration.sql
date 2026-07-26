-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "processingOptions" JSONB;

-- CreateTable
CREATE TABLE "ProcessingPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessingPreset_userId_idx" ON "ProcessingPreset"("userId");

-- AddForeignKey
ALTER TABLE "ProcessingPreset" ADD CONSTRAINT "ProcessingPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
