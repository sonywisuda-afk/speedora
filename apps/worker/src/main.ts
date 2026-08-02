import * as path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

// Type-only - erased entirely at compile time, so this doesn't reintroduce
// the module-scope-import-order hazard the dynamic-import comment below
// warns about (nothing here runs, it only names a type for the `enabled()`
// helper in main()).
import type { QueueName } from '@speedora/shared';
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
    notificationDeliveryQueue,
    probeVideoQueue,
    publishClipQueue,
    renderClipQueue,
    schedulePublishClipQueue,
    syncFollowerCountQueue,
    syncPublishStatsQueue,
    telegramChatDiscoveryQueue,
  } = await import('./queues');
  const { createImportYoutubeWorker } = await import('./workers/import-youtube.worker');
  const { createProbeVideoWorker } = await import('./workers/probe-video.worker');
  const { createTranscribeWorker } = await import('./workers/transcribe.worker');
  const { createDetectClipsWorker } = await import('./workers/detect-clips.worker');
  const { createGenerateMoreClipsWorker } = await import('./workers/generate-more-clips.worker');
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
  const {
    createSyncFollowerCountWorker,
    scheduleRepeatingTrigger: scheduleSyncFollowerCountTrigger,
  } = await import('./workers/sync-follower-count.worker');
  const { createExportGenerateWorker } = await import('./export-generate/export-generate.worker');
  const { createGeneratePlatformCopyWorker } =
    await import('./workers/generate-platform-copy.worker');
  const { createTranslateTranscriptWorker } = await import('./workers/translate-transcript.worker');
  const { createAlertEngineWorker, scheduleRepeatingTrigger: scheduleAlertEngineTrigger } =
    await import('./workers/alert-engine.worker');
  const { createNotificationDeliveryWorker } =
    await import('./workers/notification-delivery.worker');
  const {
    createTelegramChatDiscoveryWorker,
    scheduleRepeatingTrigger: scheduleTelegramChatDiscoveryTrigger,
  } = await import('./workers/telegram-chat-discovery.worker');
  const { closeNotificationPublisher } = await import('./notificationPublisher');
  const { prisma } = await import('./prisma');
  const { forStage } = await import('./logger');
  const { QueueName } = await import('@speedora/shared');
  const { parseWorkerQueues, isQueueEnabled, resolveEffectiveQueues } =
    await import('./workerQueueSelection');
  const { createRedisConnection } = await import('./redis');
  const { startWorkerHeartbeat, resolveWorkerId } = await import('./workerHeartbeat');
  const logger = forStage('main');

  // Oracle Cloud Free hybrid deployment (Fase 2) - already validated by
  // validateEnv() above, so this can't throw here. null (the default, unset)
  // means every queue, identical to pre-Fase-2 behavior.
  const enabledQueues = parseWorkerQueues(process.env.WORKER_QUEUES);
  const enabled = (queueName: QueueName) => isQueueEnabled(queueName, enabledQueues);

  // Oracle Cloud Free hybrid deployment (Fase 3) - a dedicated connection,
  // not one of the 16 above (which each already open their own), so the
  // heartbeat keeps beating independent of any one queue's lifecycle and
  // shutdown() below can close it on its own schedule.
  const workerId = resolveWorkerId();
  const heartbeatRedis = createRedisConnection();
  const heartbeat = startWorkerHeartbeat(
    heartbeatRedis,
    workerId,
    resolveEffectiveQueues(enabledQueues),
    {
      intervalMs: process.env.WORKER_HEARTBEAT_INTERVAL_MS
        ? Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS)
        : undefined,
      ttlSeconds: process.env.WORKER_HEARTBEAT_TTL_SECONDS
        ? Number(process.env.WORKER_HEARTBEAT_TTL_SECONDS)
        : undefined,
    },
  );

  // Registers (or re-confirms) each repeatable trigger before the worker
  // that consumes it starts, so there's no window where a queue could fire
  // before anything is listening. Gated the same way as the workers below -
  // a host not running e.g. sync-publish-stats shouldn't also register its
  // repeatable trigger (harmless either way since BullMQ dedups repeatable
  // jobs by id, but keeps each host's responsibility list unambiguous).
  if (enabled(QueueName.SCHEDULE_PUBLISH_CLIP)) await scheduleSchedulePublishClipTrigger();
  if (enabled(QueueName.SYNC_PUBLISH_STATS)) await scheduleSyncPublishStatsTrigger();
  if (enabled(QueueName.SYNC_FOLLOWER_COUNT)) await scheduleSyncFollowerCountTrigger();
  if (enabled(QueueName.ALERT_ENGINE)) await scheduleAlertEngineTrigger();
  if (enabled(QueueName.TELEGRAM_CHAT_DISCOVERY)) await scheduleTelegramChatDiscoveryTrigger();

  const workerCandidates = [
    enabled(QueueName.IMPORT_YOUTUBE) && createImportYoutubeWorker(),
    enabled(QueueName.PROBE_VIDEO) && createProbeVideoWorker(),
    enabled(QueueName.TRANSCRIBE) && createTranscribeWorker(),
    enabled(QueueName.DETECT_CLIPS) && createDetectClipsWorker(),
    enabled(QueueName.GENERATE_MORE_CLIPS) && createGenerateMoreClipsWorker(),
    enabled(QueueName.RENDER_CLIP) && createRenderClipWorker(),
    enabled(QueueName.PUBLISH_CLIP) && createPublishClipWorker(),
    enabled(QueueName.SCHEDULE_PUBLISH_CLIP) && createSchedulePublishClipWorker(),
    enabled(QueueName.SYNC_PUBLISH_STATS) && createSyncPublishStatsWorker(),
    enabled(QueueName.SYNC_FOLLOWER_COUNT) && createSyncFollowerCountWorker(),
    enabled(QueueName.EXPORT_GENERATE) && createExportGenerateWorker(),
    enabled(QueueName.GENERATE_PLATFORM_COPY) && createGeneratePlatformCopyWorker(),
    enabled(QueueName.TRANSLATE_TRANSCRIPT) && createTranslateTranscriptWorker(),
    enabled(QueueName.ALERT_ENGINE) && createAlertEngineWorker(),
    enabled(QueueName.NOTIFICATION_DELIVERY) && createNotificationDeliveryWorker(),
    enabled(QueueName.TELEGRAM_CHAT_DISCOVERY) && createTelegramChatDiscoveryWorker(),
  ];
  const workers = workerCandidates.filter(
    (worker): worker is Exclude<typeof worker, false> => worker !== false,
  );

  logger.info('worker started', {
    workerId,
    queueCount: workers.length,
    queues: enabledQueues ? [...enabledQueues] : 'all',
  });

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
      // Deletes the heartbeat key immediately (rather than waiting out its
      // TTL) so GET /workers/health reflects a graceful shutdown right
      // away - stopped before the workers below so this worker stops
      // being reported as available before its queues actually finish
      // draining.
      await heartbeat.stop();
      await heartbeatRedis.quit();
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([
        probeVideoQueue.close(),
        detectClipsQueue.close(),
        renderClipQueue.close(),
        publishClipQueue.close(),
        schedulePublishClipQueue.close(),
        syncPublishStatsQueue.close(),
        syncFollowerCountQueue.close(),
        alertEngineQueue.close(),
        notificationDeliveryQueue.close(),
        telegramChatDiscoveryQueue.close(),
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
