import { readFile } from 'node:fs/promises';
import * as Sentry from '@sentry/node';
import { updateVideoStatus, VideoStatus } from '@speedora/database';
import {
  QueueName,
  type ImportYoutubeJobData,
  type ImportYoutubeJobResult,
} from '@speedora/shared';
import { uploadObject } from '@speedora/storage';
import { Worker, type Job } from 'bullmq';
import { prisma } from '../prisma';
import { transcribeQueue } from '../queues';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveScratchPath } from '../storage';
import { downloadYoutubeVideo } from '../youtube';

export function createImportYoutubeWorker(): Worker<ImportYoutubeJobData, ImportYoutubeJobResult> {
  return new Worker<ImportYoutubeJobData, ImportYoutubeJobResult>(
    QueueName.IMPORT_YOUTUBE,
    async (job: Job<ImportYoutubeJobData>) => {
      const { videoId, url, provider } = job.data;
      console.log(`[import-youtube] downloading video ${videoId} from ${url}`);

      let downloadPath: string | null = null;

      try {
        downloadPath = await reserveScratchPath('youtube-import', '.mp4');
        await downloadYoutubeVideo(url, downloadPath);

        // Keyed by videoId, not a fresh random id - same "one persisted
        // object per domain row" convention as renders/<clipId>.mp4
        // (render-clip.worker.ts). apps/worker is a legitimate second
        // writer of videos/*, alongside StorageService.saveVideo() (apps/api)
        // for a direct upload.
        const buffer = await readFile(downloadPath);
        const sourceUrl = `videos/${videoId}.mp4`;
        await uploadObject(sourceUrl, buffer, 'video/mp4');

        await updateVideoStatus(prisma, videoId, VideoStatus.UPLOADED, { data: { sourceUrl } });

        console.log(`[import-youtube] video ${videoId} -> ${sourceUrl}`);

        await transcribeQueue.add(QueueName.TRANSCRIBE, { videoId, sourceUrl, provider });

        return { videoId, sourceUrl };
      } catch (error) {
        console.error(`[import-youtube] video ${videoId} failed:`, error);
        // Tags only - never the URL's page content or any downloaded bytes.
        Sentry.captureException(error, { tags: { videoId } });
        await updateVideoStatus(prisma, videoId, VideoStatus.FAILED, {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        if (downloadPath) await cleanupTempFile(downloadPath);
      }
    },
    { connection: createRedisConnection() },
  );
}
