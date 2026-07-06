-- CreateTable
CREATE TABLE "VideoStatusEvent" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "toStatus" "VideoStatus" NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoStatusEvent_videoId_createdAt_idx" ON "VideoStatusEvent"("videoId", "createdAt");

-- AddForeignKey
ALTER TABLE "VideoStatusEvent" ADD CONSTRAINT "VideoStatusEvent_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
