-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'TELEGRAM';

-- AlterTable
ALTER TABLE "NotificationWebhook" ADD COLUMN     "chatId" TEXT,
ADD COLUMN     "telegramBotUsername" TEXT,
ADD COLUMN     "telegramUpdateOffset" INTEGER;
