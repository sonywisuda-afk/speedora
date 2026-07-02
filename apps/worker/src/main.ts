import * as path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

import { detectClipsQueue } from './queues';
import { createTranscribeWorker } from './workers/transcribe.worker';
import { createDetectClipsWorker } from './workers/detect-clips.worker';
import { createRenderClipWorker } from './workers/render-clip.worker';

function main() {
  const workers = [createTranscribeWorker(), createDetectClipsWorker(), createRenderClipWorker()];

  console.log(`worker started, listening on ${workers.length} queues`);

  const shutdown = async () => {
    console.log('shutting down workers...');
    await Promise.all(workers.map((worker) => worker.close()));
    await detectClipsQueue.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
