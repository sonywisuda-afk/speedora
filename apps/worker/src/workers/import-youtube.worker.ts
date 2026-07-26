import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import * as Sentry from '@sentry/node';
import { updateVideoStatus, VideoStatus } from '@speedora/database';
import {
  QueueName,
  recordVideoImportOutcome,
  type ImportYoutubeJobData,
  type ImportYoutubeJobResult,
  type VideoImportOutcomeEvent,
} from '@speedora/shared';
import { uploadObject } from '@speedora/storage';
import {
  loadVideoImportEngineConfig,
  resolveEngine,
  toFailureMetricEvent,
  toSuccessMetricEvent,
  VideoImportError,
  type EngineHealth,
  type ImportDeps,
  type SpawnedProcess,
  type VideoImportEngine,
} from '@speedora/video-import-engine';
import { Worker, type Job } from 'bullmq';
import { JobTimeoutError, withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { enqueueNotificationDelivery } from '../notificationDeliveryEnqueuer';
import { publishNotification } from '../notificationPublisher';
import { prisma } from '../prisma';
import { transcribeQueue } from '../queues';
import { createRedisConnection } from '../redis';
import { cleanupTempFile } from '../storage';
import { limitExecFile } from '../subprocessLimiter';

// Real percentage from the engine's own onProgress callback - never a
// fabricated/interpolated animation, same "Postgres, not BullMQ's
// job.updateProgress()" reasoning as transcribe.worker.ts's reportProgress.
// Rounded since the engine reports fractional percent (e.g. 45.23) but
// Video.importProgress is an Int column.
async function reportProgress(videoId: string, percent: number): Promise<void> {
  await prisma.video.update({
    where: { id: videoId },
    data: { importProgress: Math.round(percent) },
  });
}

// Defense-in-depth outer bound (see jobTimeout.ts) - VideoImportEngineConfig's
// own timeoutMs (60m default) plus headroom for the upload step afterward.
const IMPORT_YOUTUBE_JOB_TIMEOUT_MS = 75 * 60 * 1000;

const logger = forStage('import-youtube');

// Only execFile calls (metadata/version lookups) go through the process-wide
// subprocess concurrency limiter - same as the old youtube.ts. The download
// itself uses spawn directly (a long-running, streamed call the limiter was
// never meant to gate - see subprocessLimiter.ts's own comment about heavy
// short-lived execFile calls).
const execFileAsync = limitExecFile(promisify(execFile));

// Constructs every external dependency the engine needs - the only place in
// this file (or in @speedora/video-import-engine) that touches
// node:child_process/node:fs/node:crypto/process.env directly, per
// ARCHITECTURE.md's deps-injection rule.
function buildImportDeps(): ImportDeps {
  return {
    spawn: (command, args) => spawn(command, args) as unknown as SpawnedProcess,
    execFile: async (command, args, options) => {
      const { stdout, stderr } = await execFileAsync(command, args, { timeout: options.timeoutMs });
      return { stdout, stderr };
    },
    fs: {
      mkdir: async (path) => {
        await mkdir(path, { recursive: true });
      },
      unlink: async (path) => {
        await unlink(path).catch(() => undefined);
      },
      stat: async (path) => {
        const { size } = await stat(path);
        return { size };
      },
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    randomId: () => randomUUID(),
    config: loadVideoImportEngineConfig(process.env),
  };
}

async function checkEngineHealth(
  engine: VideoImportEngine,
  deps: ImportDeps,
): Promise<EngineHealth> {
  return engine.checkVersion(deps).catch((): EngineHealth => ({
    engineName: engine.name,
    engineVersion: null,
    status: 'unreachable',
  }));
}

export function createImportYoutubeWorker(): Worker<ImportYoutubeJobData, ImportYoutubeJobResult> {
  // One connection reused across every job this worker processes - separate
  // from the Worker's own BullMQ connection below since it serves a
  // different concern (cross-process metrics, read back by apps/api's
  // GET /metrics via @speedora/shared's readVideoImportMetrics).
  const metricsRedis = createRedisConnection();

  return new Worker<ImportYoutubeJobData, ImportYoutubeJobResult>(
    QueueName.IMPORT_YOUTUBE,
    (job: Job<ImportYoutubeJobData>) => {
      // Bridges withJobTimeout's own Promise.race (which can only make the
      // OUTER promise it returns reject promptly - it can never actually
      // cancel whatever's still running inside fn(), see jobTimeout.ts's own
      // comment) to the engine's real subprocess cancellation. Deliberately
      // created here, outside fn, and awaited via the .catch() below on
      // withJobTimeout's own returned promise - fn's own try/catch can never
      // see a JobTimeoutError (it's thrown by the sibling `timeout` promise
      // in the race, not by fn itself), so this is the only place that can
      // actually observe "the job-level timeout won." The same signal seam
      // covers a future explicit "cancel import" action too - whatever
      // triggers it just needs to call controller.abort().
      const controller = new AbortController();

      return withJobTimeout(
        async () => {
          const { videoId, url, provider } = job.data;

          // Same orphaned-job guard as transcribe/detect-clips/render-clip
          // workers - a video can be deleted while this job is still queued,
          // and without this check the job would burn a real (possibly
          // large, multi-minute) download before failing on the final
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
          // (see VideosService.upload/retry, the only two callers that
          // enqueue it) - status having moved past it already means some
          // execution of this same job already finished the real download,
          // so re-doing it here would only waste a multi-minute download,
          // not produce a different or more-correct result.
          if (existingVideo.status !== VideoStatus.IMPORTING) {
            logger.info(
              'video is already past IMPORTING - skipping to avoid a duplicate download',
              { videoId, status: existingVideo.status },
            );
            return { videoId, sourceUrl: '' };
          }

          logger.info('downloading video', { videoId, url });

          const deps = buildImportDeps();
          const startedAt = Date.now();
          let engine: VideoImportEngine | undefined;
          let downloadPath: string | null = null;

          try {
            // Reset before anything else - a retry re-runs this same job
            // from scratch (VideosService.retry also resets it eagerly so
            // the click itself doesn't show a stale value), and without
            // this a failed attempt's last-reached percentage would
            // otherwise linger.
            await reportProgress(videoId, 0);

            // Throws (category 'unsupported') before any subprocess is
            // spawned if the URL's domain isn't allowlisted.
            engine = resolveEngine(url, deps.config);

            // Best-effort, never fails the job (see the engine's own
            // fetchMetadata comment). Fetched before the download starts
            // since it's a separate, much shorter subprocess call, not
            // extracted from the downloaded file itself.
            const metadata = await engine.fetchMetadata(url, deps);

            const downloadResult = await engine.download({ url }, deps, {
              // Fire-and-forget - a dropped/delayed progress write is
              // harmless (the next one supersedes it), and awaiting each
              // one would serialize the DB round-trip behind the engine's
              // own progress-event cadence for no benefit.
              onProgress: (percent) => {
                reportProgress(videoId, percent).catch(() => {});
              },
              signal: controller.signal,
            });
            downloadPath = downloadResult.outputPath;

            const health = await checkEngineHealth(engine, deps);

            // Keyed by videoId, not a fresh random id - same "one persisted
            // object per domain row" convention as renders/<clipId>.mp4
            // (render-clip.worker.ts).
            const sourceUrl = `videos/${videoId}.mp4`;
            const { size: sourceSizeBytes } = await stat(downloadPath);
            await uploadObject(sourceUrl, createReadStream(downloadPath), 'video/mp4');

            await updateVideoStatus(prisma, videoId, VideoStatus.UPLOADED, {
              data: { sourceUrl, importProgress: null, title: metadata.title, sourceSizeBytes },
            });

            logger.info('video imported', {
              videoId,
              sourceUrl,
              engineName: engine.name,
              engineVersion: health.engineVersion,
              durationMs: downloadResult.durationMs,
              retries: downloadResult.retries,
            });

            recordVideoImportOutcome(metricsRedis, {
              ...toSuccessMetricEvent(downloadResult),
              engineName: engine.name,
              engineVersion: health.engineVersion,
              engineHealthStatus: health.status,
            }).catch(() => {});

            await transcribeQueue.add(QueueName.TRANSCRIBE, { videoId, sourceUrl, provider });

            return { videoId, sourceUrl };
          } catch (error) {
            logger.error(
              'video failed',
              {
                videoId,
                category: error instanceof VideoImportError ? error.category : undefined,
                exitCode: error instanceof VideoImportError ? error.exitCode : undefined,
                stderrExcerpt: error instanceof VideoImportError ? error.stderrExcerpt : undefined,
              },
              error,
            );
            // Tags only - never the URL's page content or any downloaded bytes.
            Sentry.captureException(error, { tags: { videoId } });

            const durationMs = Date.now() - startedAt;
            const health = engine ? await checkEngineHealth(engine, deps) : null;
            const failureEvent: VideoImportOutcomeEvent =
              error instanceof VideoImportError
                ? {
                    ...toFailureMetricEvent(error, durationMs),
                    engineName: error.engineName,
                    engineVersion: health?.engineVersion ?? null,
                    engineHealthStatus: health?.status ?? 'unreachable',
                  }
                : {
                    outcome: 'failure',
                    durationMs,
                    retries: 0,
                    timedOut: false,
                    cancelled: false,
                    engineName: engine?.name ?? 'unknown',
                    engineVersion: health?.engineVersion ?? null,
                    engineHealthStatus: health?.status ?? 'unreachable',
                  };
            recordVideoImportOutcome(metricsRedis, failureEvent).catch(() => {});

            await updateVideoStatus(
              prisma,
              videoId,
              VideoStatus.FAILED,
              { errorMessage: error instanceof Error ? error.message : String(error) },
              { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
            );
            throw error;
          } finally {
            if (downloadPath) await cleanupTempFile(downloadPath);
          }
        },
        IMPORT_YOUTUBE_JOB_TIMEOUT_MS,
        `import-youtube:${job.data.videoId}`,
      ).catch((error: unknown) => {
        // The only place a JobTimeoutError can actually be observed (see the
        // comment on `controller` above) - aborts the signal fn() is still
        // running against, which the engine uses to SIGTERM/SIGKILL its
        // child process, and lets fn() eventually reach its own catch block
        // (Sentry, metrics, Video FAILED) once that abort resolves, even
        // though this rejection has already told BullMQ the job failed.
        if (error instanceof JobTimeoutError) controller.abort(error);
        throw error;
      });
    },
    {
      connection: createRedisConnection(),
      // Explicit, not the implicit default - same "one at a time per worker
      // process, raise only after a real capacity-planning decision"
      // reasoning as transcribe.worker.ts.
      concurrency: 1,
      // Comfortably above this job's worst-case real duration (a large
      // download) - same BullMQ stalled-job mis-detection reasoning as
      // transcribe.worker.ts (a real incident: a completed download sitting
      // at importProgress 100 with no forward progress got reprocessed from
      // scratch).
      lockDuration: 20 * 60 * 1000,
    },
  );
}
