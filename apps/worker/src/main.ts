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

  // Registers (or re-confirms) each repeatable trigger before the worker
  // that consumes it starts, so there's no window where a queue could fire
  // before anything is listening.
  await scheduleSchedulePublishClipTrigger();
  await scheduleSyncPublishStatsTrigger();

  const workers = [
    createImportYoutubeWorker(),
    createTranscribeWorker(),
    createDetectClipsWorker(),
    createRenderClipWorker(),
    createPublishClipWorker(),
    createSchedulePublishClipWorker(),
    createSyncPublishStatsWorker(),
  ];

  console.log(`worker started, listening on ${workers.length} queues`);

  const shutdown = async () => {
    console.log('shutting down workers...');
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all([
      transcribeQueue.close(),
      detectClipsQueue.close(),
      renderClipQueue.close(),
      publishClipQueue.close(),
      schedulePublishClipQueue.close(),
      syncPublishStatsQueue.close(),
    ]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[worker] failed to start:', error);
  process.exit(1);
});
