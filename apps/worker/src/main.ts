import * as path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

import { initSentry } from './sentry';

// Before validateEnv() (which can itself throw) and everything else below,
// so as much of startup and every job as possible runs inside Sentry's
// instrumentation - including its default uncaughtException/
// unhandledRejection handlers.
initSentry();

import { validateEnv } from './env';

// Runs before ./queues/./workers are imported below, so a missing
// DATABASE_URL/REDIS_URL/OPENAI_API_KEY/STORAGE_* fails immediately with a
// clear message instead of failing later (or silently) once a Queue,
// PrismaClient, or the OpenAI client actually tries to use it.
validateEnv();

async function main() {
  // Dynamic imports, not static ones, for everything below - and this is
  // load-bearing, not stylistic. `tsx watch` (this package's "dev" script)
  // runs .ts files as native ESM, where static `import` declarations are
  // hoisted to the top of the module and evaluated before any other code in
  // the file regardless of where they're textually written - unlike
  // `node dist/main.js` (the production path, and what `npx tsx` runs
  // without `watch`), which compiles/behaves as CommonJS and evaluates
  // `require()` calls in the order they actually appear. A static import
  // here would load ../openai.ts - which constructs `new OpenAI(...)` at
  // module scope, not inside a function - before config()/validateEnv()
  // above ever ran, throwing "Missing credentials" even with a perfectly
  // valid .env. Dynamic import() is never hoisted in either mode, so this
  // is the one construct that's guaranteed to run after the env is loaded
  // no matter how this file is executed.
  const {
    alertEngineQueue,
    detectClipsQueue,
    publishClipQueue,
    renderClipQueue,
    schedulePublishClipQueue,
    syncPublishStatsQueue,
    transcribeQueue,
  } = await import('./queues');
  const { createImportYoutubeWorker } = await import('./workers/import-youtube.worker');
  const { createTranscribeWorker } = await import('./workers/transcribe.worker');
  const { createDetectClipsWorker } = await import('./workers/detect-clips.worker');
  const { createRenderClipWorker } = await import('./workers/render-clip.worker');
  const { createPublishClipWorker } = await import('./workers/publish-clip.worker');
  const {
    createSchedulePublishClipWorker,
    scheduleRepeatingTrigger: scheduleSchedulePublishClipTrigger,
  } = await import('./workers/schedule-publish-clip.worker');
  const {
    createSyncPublishStatsWorker,
    scheduleRepeatingTrigger: scheduleSyncPublishStatsTrigger,
  } = await import('./workers/sync-publish-stats.worker');
  const { createExportGenerateWorker } = await import('./export-generate/export-generate.worker');
  const { createAlertEngineWorker, scheduleRepeatingTrigger: scheduleAlertEngineTrigger } =
    await import('./workers/alert-engine.worker');
  const { closeNotificationPublisher } = await import('./notificationPublisher');
  const { prisma } = await import('./prisma');
  const { forStage } = await import('./logger');
  const logger = forStage('main');

  // Registers (or re-confirms) each repeatable trigger before the worker
  // that consumes it starts, so there's no window where a queue could fire
  // before anything is listening.
  await scheduleSchedulePublishClipTrigger();
  await scheduleSyncPublishStatsTrigger();
  await scheduleAlertEngineTrigger();

  const workers = [
    createImportYoutubeWorker(),
    createTranscribeWorker(),
    createDetectClipsWorker(),
    createRenderClipWorker(),
    createPublishClipWorker(),
    createSchedulePublishClipWorker(),
    createSyncPublishStatsWorker(),
    createExportGenerateWorker(),
    createAlertEngineWorker(),
  ];

  logger.info('worker started', { queueCount: workers.length });

  // Generous margin over worker.close()'s own wait for in-flight jobs to
  // finish (each job is bounded well under this by its own lockDuration/
  // subprocess timeouts) plus queue/DB teardown - without this, a job or
  // connection that hangs during shutdown itself would block `docker stop`
  // indefinitely until it's SIGKILLed, rather than exiting cleanly (if
  // slowly) on its own.
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  let shuttingDown = false;

  const shutdown = async () => {
    // SIGINT and SIGTERM can both arrive (or the same signal twice) -
    // without this guard, a second call would race the first's queue/worker
    // .close() calls and process.exit().
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('shutting down workers');
    const forceExitTimer = setTimeout(() => {
      logger.error('graceful shutdown exceeded timeout, forcing exit', {
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([
        transcribeQueue.close(),
        detectClipsQueue.close(),
        renderClipQueue.close(),
        publishClipQueue.close(),
        schedulePublishClipQueue.close(),
        syncPublishStatsQueue.close(),
        alertEngineQueue.close(),
      ]);
      // Milestone 04c - the shared publish-only Redis connection, closed
      // after every worker is done touching it (each worker's own
      // recordNotification()/updateVideoStatus() calls may still be
      // in-flight until worker.close() above resolves).
      await closeNotificationPublisher();
      // Closed last, after every worker/queue is done touching it - not
      // strictly required before process.exit() would tear the process down
      // anyway, but an explicit disconnect lets Postgres release the
      // connection immediately rather than waiting for the socket to time
      // out server-side.
      await prisma.$disconnect();
    } finally {
      clearTimeout(forceExitTimer);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (error) => {
  const { forStage } = await import('./logger');
  forStage('main').error('worker failed to start', {}, error);
  process.exit(1);
});
