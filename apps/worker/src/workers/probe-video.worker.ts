import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import { updateVideoStatus, VideoStatus } from '@speedora/database';
import { QueueName, type ProbeVideoJobData, type ProbeVideoJobResult } from '@speedora/shared';
import { getObjectStream } from '@speedora/storage';
import { evaluateVideoQuality } from '@speedora/video-validation';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { probeVideoMetadata } from '../ffmpeg';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { enqueueNotificationDelivery } from '../notificationDeliveryEnqueuer';
import { publishNotification } from '../notificationPublisher';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveScratchPath } from '../storage';

const logger = forStage('probe-video');

// Generous over a plain metadata read - the real cost here is downloading
// the source (a large upload on a slow connection) before ffprobe ever
// runs, same "large-file download dominates" reasoning as
// import-youtube.worker.ts's own IMPORT_YOUTUBE_JOB_TIMEOUT_MS, just
// smaller since there's no encode/API-call work after the download.
const PROBE_VIDEO_JOB_TIMEOUT_MS = 10 * 60 * 1000;

// Quality Validation roadmap (Fase 0 design, Phase 1) - the first real
// processing stage after upload. Deliberately does NOT self-chain into
// TRANSCRIBE on success (see QueueName.PROBE_VIDEO's own comment) - it
// stops at PENDING_SETTINGS and waits for the user to submit Processing
// Settings (apps/api's POST /videos/:id/start-processing enqueues
// TRANSCRIBE instead). Only Phase 1's "no rules yet, just metadata
// capture" checks run here (no video stream, no audio stream, zero/
// unreadable duration) - Phase 2's packages/video-validation owns the
// Warning/Info-tier rule evaluation over the metadata this job persists.
export function createProbeVideoWorker(): Worker<ProbeVideoJobData, ProbeVideoJobResult> {
  return new Worker<ProbeVideoJobData, ProbeVideoJobResult>(
    QueueName.PROBE_VIDEO,
    (job: Job<ProbeVideoJobData>) =>
      withJobTimeout(
        async () => {
          const { videoId, sourceUrl } = job.data;

          // Same orphaned-job guard as every other stage worker - a video
          // can be deleted while this job is still queued.
          const existingVideo = await prisma.video.findUnique({
            where: { id: videoId },
            select: { status: true },
          });
          if (!existingVideo) {
            logger.info('video was deleted - skipping orphaned job', { videoId });
            return { videoId };
          }

          // Idempotency guard: same BullMQ stalled-job re-processing risk as
          // transcribe.worker.ts (see its own comment for the incident this
          // pattern was born from). UPLOADED is this job's own precondition
          // (see VideosService.upload/importFromYoutube/retry, the only
          // callers that enqueue it) - status having moved past it already
          // means some execution of this same job already finished probing.
          if (existingVideo.status !== VideoStatus.UPLOADED) {
            logger.info('video is already past UPLOADED - skipping to avoid a duplicate probe', {
              videoId,
              status: existingVideo.status,
            });
            return { videoId };
          }

          logger.info('probing video', { videoId, sourceUrl });

          let sourcePath: string | null = null;
          try {
            sourcePath = await reserveScratchPath('probe-src', path.extname(sourceUrl) || '.mp4');
            const sourceStream = await getObjectStream(sourceUrl);
            await pipeline(sourceStream, createWriteStream(sourcePath));

            const metadata = await probeVideoMetadata(sourcePath);

            // Error-tier findings (per the Fase 0 design's 3-tier
            // classification) - the only checks Phase 1 runs itself, since
            // these gate whether there's even a usable video to hand off to
            // Processing Settings. Everything else (low resolution/bitrate,
            // unstable fps, very long duration, mono audio) is Phase 2's
            // Warning-tier rule evaluation over the metadata persisted below.
            // UnrecoverableError, not a plain Error - these are deterministic
            // content problems (a re-probe of the exact same bytes always
            // finds the same missing stream/duration), unlike a transient
            // ffprobe process crash. Skips PROBE_VIDEO_RETRY_OPTIONS's
            // remaining attempts entirely, same coordination
            // import-youtube.worker.ts uses for VideoImportError.retryable
            // === false.
            if (!metadata.hasVideoStream) {
              throw new UnrecoverableError('Video tidak memiliki video stream yang valid');
            }
            if (!metadata.hasAudioStream) {
              throw new UnrecoverableError(
                'Video tidak memiliki audio stream - transkripsi membutuhkan audio',
              );
            }
            if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) {
              throw new UnrecoverableError('Video kosong atau durasinya tidak dapat dibaca');
            }

            // Quality Validation roadmap (Fase 0 design, Phase 2) - Warning/
            // Info-tier rule evaluation over the metadata just probed. Only
            // reached once every Error-tier check above has already passed,
            // matching the design's "Error stops here, Warning/Info still
            // let the video reach Processing Settings" split.
            const validationReport = evaluateVideoQuality({
              width: metadata.width,
              height: metadata.height,
              fps: metadata.fps,
              videoBitrate: metadata.videoBitrate,
              audioChannels: metadata.audioChannels,
              durationSeconds: metadata.durationSeconds,
            });

            await updateVideoStatus(
              prisma,
              videoId,
              VideoStatus.PENDING_SETTINGS,
              {
                data: {
                  durationSeconds: metadata.durationSeconds,
                  width: metadata.width,
                  height: metadata.height,
                  fps: metadata.fps,
                  videoCodec: metadata.videoCodec,
                  videoBitrate: metadata.videoBitrate,
                  audioCodec: metadata.audioCodec,
                  audioSampleRate: metadata.audioSampleRate,
                  audioChannels: metadata.audioChannels,
                  audioBitrate: metadata.audioBitrate,
                  validationReport,
                },
              },
              { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
            );

            logger.info('video probed', {
              videoId,
              width: metadata.width,
              height: metadata.height,
              durationSeconds: metadata.durationSeconds,
              warningCount: validationReport.warnings.length,
            });

            return { videoId };
          } catch (error) {
            // Download Reliability Framework's coordination, reused here:
            // an UnrecoverableError (thrown above for a deterministic
            // content problem) is never retryable; anything else defaults
            // retryable (conservative - we can't prove a raw execFile/fs
            // exception is permanent), same "unknown error defaults
            // retryable" reasoning as import-youtube.worker.ts.
            const isRetryable = !(error instanceof UnrecoverableError);
            const attemptNumber = job.attemptsMade + 1;
            const maxAttempts = job.opts.attempts ?? 1;
            const isFinalAttempt = !isRetryable || attemptNumber >= maxAttempts;

            logger.error(
              'video probe failed',
              { videoId, attempt: attemptNumber, maxAttempts, willRetry: !isFinalAttempt },
              error,
            );
            Sentry.captureException(error, { tags: { videoId } });

            // Only write the terminal FAILED status once this is genuinely
            // the last attempt - leaving Video.status at UPLOADED on a
            // non-final attempt is what lets the idempotency guard above
            // pass on BullMQ's next attempt instead of skipping it as
            // "already past UPLOADED", same reasoning as
            // import-youtube.worker.ts's own isFinalAttempt gating.
            if (isFinalAttempt) {
              await updateVideoStatus(
                prisma,
                videoId,
                VideoStatus.FAILED,
                { errorMessage: error instanceof Error ? error.message : String(error) },
                { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
              );
            }
            throw error;
          } finally {
            if (sourcePath) await cleanupTempFile(sourcePath);
          }
        },
        PROBE_VIDEO_JOB_TIMEOUT_MS,
        `probe-video:${job.data.videoId}`,
      ),
    {
      connection: createRedisConnection(),
      // Explicit, not the implicit default - same "one at a time per worker
      // process" reasoning as transcribe.worker.ts/import-youtube.worker.ts.
      concurrency: 1,
      lockDuration: 15 * 60 * 1000,
    },
  );
}
