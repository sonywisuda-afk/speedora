-- AlterEnum
ALTER TYPE "VideoStatus" ADD VALUE 'PENDING_SETTINGS';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "audioBitrate" INTEGER,
ADD COLUMN     "audioChannels" INTEGER,
ADD COLUMN     "audioCodec" TEXT,
ADD COLUMN     "audioSampleRate" INTEGER,
ADD COLUMN     "fps" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "validationReport" JSONB,
ADD COLUMN     "videoBitrate" INTEGER,
ADD COLUMN     "videoCodec" TEXT,
ADD COLUMN     "width" INTEGER;
