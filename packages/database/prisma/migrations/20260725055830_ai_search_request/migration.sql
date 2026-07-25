-- CreateTable
CREATE TABLE "AiSearchRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSearchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSearchRequest_userId_createdAt_idx" ON "AiSearchRequest"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiSearchRequest" ADD CONSTRAINT "AiSearchRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
