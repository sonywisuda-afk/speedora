-- CreateEnum
CREATE TYPE "TranscriptionProvider" AS ENUM ('GROQ', 'OPENAI');

-- CreateEnum
CREATE TYPE "PremiumCreditStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "transcriptionProvider" "TranscriptionProvider" NOT NULL DEFAULT 'GROQ';

-- CreateTable
CREATE TABLE "PremiumCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PremiumCreditStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "midtransOrderId" TEXT NOT NULL,
    "videoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PremiumCredit_midtransOrderId_key" ON "PremiumCredit"("midtransOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumCredit_videoId_key" ON "PremiumCredit"("videoId");

-- CreateIndex
CREATE INDEX "PremiumCredit_userId_idx" ON "PremiumCredit"("userId");

-- AddForeignKey
ALTER TABLE "PremiumCredit" ADD CONSTRAINT "PremiumCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumCredit" ADD CONSTRAINT "PremiumCredit_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
