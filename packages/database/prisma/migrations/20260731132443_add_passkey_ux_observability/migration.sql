-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'ELEVATION_SUCCESS';
ALTER TYPE "SecurityEventType" ADD VALUE 'ELEVATION_FAILED';

-- AlterTable
ALTER TABLE "Passkey" ADD COLUMN     "createdDeviceLabel" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "createdVia" TEXT;
