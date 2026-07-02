import * as path from 'node:path';
import { VideoStatus } from '@viral-clip-app/database';
import {
  QueueName,
  type TranscribeJobData,
  type TranscribeJobResult,
} from '@viral-clip-app/shared';
import { getObjectStream } from '@viral-clip-app/storage';
import { Worker, type Job } from 'bullmq';
import { toFile } from 'openai';
import { openai } from '../openai';
import { prisma } from '../prisma';
import { detectClipsQueue } from '../queues';
import { createRedisConnection } from '../redis';

export function createTranscribeWorker(): Worker<TranscribeJobData, TranscribeJobResult> {
  return new Worker<TranscribeJobData, TranscribeJobResult>(
    QueueName.TRANSCRIBE,
    async (job: Job<TranscribeJobData>) => {
      const { videoId, sourceUrl } = job.data;
      console.log(`[transcribe] processing video ${videoId} from ${sourceUrl}`);

      try {
        // sourceUrl is an object storage key; stream it straight from the
        // bucket into Whisper without ever touching local disk (unlike
        // render-clip, which needs a real file for ffmpeg to seek within).
        const stream = await getObjectStream(sourceUrl);
        const file = await toFile(stream, path.basename(sourceUrl));

        const transcription = await openai.audio.transcriptions.create({
          file,
          model: 'whisper-1',
          response_format: 'verbose_json',
          timestamp_granularities: ['segment'],
        });

        const segments = (transcription.segments ?? []).map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
        }));

        await prisma.$transaction([
          prisma.transcriptSegment.createMany({
            data: segments.map((segment) => ({ videoId, ...segment })),
          }),
          prisma.video.update({
            where: { id: videoId },
            data: { status: VideoStatus.TRANSCRIBED },
          }),
        ]);

        console.log(`[transcribe] video ${videoId} -> ${segments.length} segments`);

        await detectClipsQueue.add(QueueName.DETECT_CLIPS, { videoId, segments });

        return { videoId, segments };
      } catch (error) {
        console.error(`[transcribe] video ${videoId} failed:`, error);
        await prisma.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.FAILED },
        });
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );
}
