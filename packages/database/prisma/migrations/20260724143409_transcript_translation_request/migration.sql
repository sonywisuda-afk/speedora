-- CreateTable
CREATE TABLE "TranscriptTranslationRequest" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptTranslationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranscriptTranslationRequest_requestedBy_createdAt_idx" ON "TranscriptTranslationRequest"("requestedBy", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptTranslationRequest_videoId_idx" ON "TranscriptTranslationRequest"("videoId");

-- AddForeignKey
ALTER TABLE "TranscriptTranslationRequest" ADD CONSTRAINT "TranscriptTranslationRequest_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
