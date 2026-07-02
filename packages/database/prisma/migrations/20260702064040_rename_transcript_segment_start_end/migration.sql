/*
  Warnings:

  - You are about to drop the column `endTime` on the `TranscriptSegment` table. All the data in the column will be lost.
  - You are about to drop the column `startTime` on the `TranscriptSegment` table. All the data in the column will be lost.
  - Added the required column `end` to the `TranscriptSegment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start` to the `TranscriptSegment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TranscriptSegment" DROP COLUMN "endTime",
DROP COLUMN "startTime",
ADD COLUMN     "end" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "start" DOUBLE PRECISION NOT NULL;
