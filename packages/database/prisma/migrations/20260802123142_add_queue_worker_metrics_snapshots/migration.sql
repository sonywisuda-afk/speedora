-- CreateTable
CREATE TABLE "QueueSnapshot" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waiting" INTEGER NOT NULL,
    "active" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "delayed" INTEGER NOT NULL,
    "paused" INTEGER NOT NULL,
    "likelyStalled" INTEGER NOT NULL,
    "failureRate" DOUBLE PRECISION,
    "avgProcessingTimeMs" INTEGER,
    "avgQueueWaitMs" INTEGER,
    "retriedJobs" INTEGER NOT NULL,

    CONSTRAINT "QueueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeatSnapshot" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "queues" TEXT[],
    "jobsActive" INTEGER NOT NULL,
    "jobsWaiting" INTEGER NOT NULL,
    "workerStartedAt" TIMESTAMP(3) NOT NULL,
    "heartbeatTtlSeconds" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerHeartbeatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueSnapshot_queueName_capturedAt_idx" ON "QueueSnapshot"("queueName", "capturedAt");

-- CreateIndex
CREATE INDEX "WorkerHeartbeatSnapshot_workerId_capturedAt_idx" ON "WorkerHeartbeatSnapshot"("workerId", "capturedAt");
