import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as Sentry from '@sentry/node';
import { updateVideoStatus, VideoStatus } from '@speedora/database';
import {
  QueueName,
  type ImportYoutubeJobData,
  type ImportYoutubeJobResult,
} from '@speedora/shared';
import { uploadObject } from '@speedora/storage';
import { Worker, type Job } from 'bullmq';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { publishNotification } from '../notificationPublisher';
import { prisma } from '../prisma';
import { transcribeQueue } from '../queues';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveScratchPath } from '../storage';
import { downloadYoutubeVideo, getYoutubeVideoTitle } from '../youtube';

// Real percentage from yt-dlp's own --progress-template output (see
// youtube.ts) - never a fabricated/interpolated animation, same "Postgres,
// not BullMQ's job.updateProgress()" reasoning as transcribe.worker.ts's
// reportProgress. Rounded since yt-dlp reports fractional percent
// (e.g. 45.23) but Video.importProgress is an Int column.
async function reportProgress(videoId: string, percent: number): Promise<void> {
  await prisma.video.update({
    where: { id: videoId },
    data: { importProgress: Math.round(percent) },
  });
}

// Defense-in-depth outer bound (see jobTimeout.ts) - YTDLP_TIMEOUT_MS (60m,
// see youtube.ts) plus headroom for the upload step afterward.
const IMPORT_YOUTUBE_JOB_TIMEOUT_MS = 75 * 60 * 1000;

const logger = forStage('import-youtube');

export function createImportYoutubeWorker(): Worker<ImportYoutubeJobData, ImportYoutubeJobResult> {
  return new Worker<ImportYoutubeJobData, ImportYoutubeJobResult>(
    QueueName.IMPORT_YOUTUBE,
    (job: Job<ImportYoutubeJobData>) =>
      withJobTimeout(
        async () => {
          const { videoId, url, provider } = job.data;

          // Same orphaned-job guard as transcribe/detect-clips/render-clip
          // workers - a video can be deleted while this job is still queued,
          // and without this check the job would burn a real (possibly large,
          // multi-minute) yt-dlp download before failing on the final
          // prisma.video.update().
          const existingVideo = await prisma.video.findUnique({
            where: { id: videoId },
            select: { status: true },
          });
          if (!existingVideo) {
            logger.info('video was deleted - skipping orphaned job', { videoId });
            return { videoId, sourceUrl: '' };
          }

          // Idempotency guard: same BullMQ stalled-job re-processing risk as
          // transcribe.worker.ts (see its comment for the full incident this
          // pattern was born from). IMPORTING is this job's own precondition
          // (see VideosService.upload/retry, the only two callers that enqueue
          // it) - status having moved past it already means some execution of
          // this same job already finished the real yt-dlp download, so
          // re-doing it here would only waste a multi-minute download, not
          // produce a different or more-correct result.
          if (existingVideo.status !== VideoStatus.IMPORTING) {
            logger.info(
              'video is already past IMPORTING - skipping to avoid a duplicate yt-dlp download',
              { videoId, status: existingVideo.status },
            );
            return { videoId, sourceUrl: '' };
          }

          logger.info('downloading video', { videoId, url });

          let downloadPath: string | null = null;

          try {
            // Reset before anything else - a retry re-runs this same job from
            // scratch (VideosService.retry also resets it eagerly so the click
            // itself doesn't show a stale value), and without this a failed
            // attempt's last-reached percentage would otherwise linger.
            await reportProgress(videoId, 0);

            // Sprint 1-2 (Dashboard Redesign) - best-effort, never fails the
            // job (see getYoutubeVideoTitle's own comment). Fetched before
            // the download starts since it's a separate, much shorter yt-dlp
            // invocation, not extracted from the downloaded file itself.
            const title = await getYoutubeVideoTitle(url);

            downloadPath = await reserveScratchPath('youtube-import', '.mp4');
            await downloadYoutubeVideo(url, downloadPath, (percent) => {
              // Fire-and-forget - a dropped/delayed progress write is harmless
              // (the next one supersedes it), and awaiting each one would
              // serialize the DB round-trip behind yt-dlp's own progress-event
              // cadence for no benefit. Errors are swallowed for the same
              // reason reportProgress below isn't guarded elsewhere: a failed
              // progress write here must never abort an otherwise-succeeding
              // download.
              reportProgress(videoId, percent).catch(() => {});
            });

            // Keyed by videoId, not a fresh random id - same "one persisted
            // object per domain row" convention as renders/<clipId>.mp4
            // (render-clip.worker.ts). apps/worker is a legitimate second
            // writer of videos/*, alongside StorageService.saveVideo() (apps/api)
            // for a direct upload.
            //
            // Streamed straight from disk (not read into a Buffer first) - a YouTube source can be
            // several hundred MB+, and unlike uploadObject's own S3 call, a plain readFile() has no
            // timeout at all, so it could hang indefinitely (observed for real: a completed download
            // sitting at importProgress 100 with no forward progress and no error) instead of failing
            // cleanly. Streaming makes this step subject to uploadObject's own requestTimeout instead.
            const sourceUrl = `videos/${videoId}.mp4`;
            // Sprint 1-2 (Dashboard Redesign) - the file's already on disk
            // (stat is a cheap local syscall, unlike readFile above), so
            // this costs nothing extra beyond the upload that's about to
            // read the same file anyway. Feeds the Dashboard's per-owner
            // Storage Used stat - see Video.sourceSizeBytes.
            const { size: sourceSizeBytes } = await stat(downloadPath);
            await uploadObject(sourceUrl, createReadStream(downloadPath), 'video/mp4');

            await updateVideoStatus(prisma, videoId, VideoStatus.UPLOADED, {
              data: { sourceUrl, importProgress: null, title, sourceSizeBytes },
            });

            logger.info('video imported', { videoId, sourceUrl });

            await transcribeQueue.add(QueueName.TRANSCRIBE, { videoId, sourceUrl, provider });

            return { videoId, sourceUrl };
          } catch (error) {
            logger.error('video failed', { videoId }, error);
            // Tags only - never the URL's page content or any downloaded bytes.
            Sentry.captureException(error, { tags: { videoId } });
            await updateVideoStatus(
              prisma,
              videoId,
              VideoStatus.FAILED,
              { errorMessage: error instanceof Error ? error.message : String(error) },
              { publish: publishNotification },
            );
            throw error;
          } finally {
            if (downloadPath) await cleanupTempFile(downloadPath);
          }
        },
        IMPORT_YOUTUBE_JOB_TIMEOUT_MS,
        `import-youtube:${job.data.videoId}`,
      ),
    {
      connection: createRedisConnection(),
      // Explicit, not the implicit default - same "one at a time per worker
      // process, raise only after a real capacity-planning decision" reasoning
      // as transcribe.worker.ts.
      concurrency: 1,
      // Comfortably above this job's worst-case real duration (a large
      // yt-dlp download) - same BullMQ stalled-job mis-detection reasoning
      // as transcribe.worker.ts (a real incident: a completed download
      // sitting at importProgress 100 with no forward progress got
      // reprocessed from scratch).
      lockDuration: 20 * 60 * 1000,
    },
  );
}
