import { Worker, type Job } from 'bullmq';
import {
  QueueName,
  type TranscribeJobData,
  type TranscribeJobResult,
} from '@viral-clip-app/shared';
import { createRedisConnection } from '../redis';

export function createTranscribeWorker(): Worker<TranscribeJobData, TranscribeJobResult> {
  return new Worker<TranscribeJobData, TranscribeJobResult>(
    QueueName.TRANSCRIBE,
    async (job: Job<TranscribeJobData>) => {
      const { videoId, sourceUrl } = job.data;

      // TODO: run Whisper ASR against sourceUrl and produce timestamped segments.
      console.log(`[transcribe] processing video ${videoId} from ${sourceUrl}`);

      return { videoId, segments: [] };
    },
    { connection: createRedisConnection() },
  );
}
