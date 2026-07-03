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

import { detectClipsQueue, renderClipQueue } from './queues';
import { createTranscribeWorker } from './workers/transcribe.worker';
import { createDetectClipsWorker } from './workers/detect-clips.worker';
import { createRenderClipWorker } from './workers/render-clip.worker';
import { createPublishClipWorker } from './workers/publish-clip.worker';

function main() {
  const workers = [
    createTranscribeWorker(),
    createDetectClipsWorker(),
    createRenderClipWorker(),
    createPublishClipWorker(),
  ];

  console.log(`worker started, listening on ${workers.length} queues`);

  const shutdown = async () => {
    console.log('shutting down workers...');
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all([detectClipsQueue.close(), renderClipQueue.close()]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
