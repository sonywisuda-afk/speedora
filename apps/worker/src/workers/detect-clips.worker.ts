import { Worker, type Job } from 'bullmq';
import {
  QueueName,
  type DetectClipsJobData,
  type DetectClipsJobResult,
} from '@viral-clip-app/shared';
import { createRedisConnection } from '../redis';

export function createDetectClipsWorker(): Worker<DetectClipsJobData, DetectClipsJobResult> {
  return new Worker<DetectClipsJobData, DetectClipsJobResult>(
    QueueName.DETECT_CLIPS,
    async (job: Job<DetectClipsJobData>) => {
      const { videoId, segments } = job.data;

      // TODO: score transcript segments and select highlight candidates.
      console.log(`[detect-clips] analyzing ${segments.length} segments for video ${videoId}`);

      return { videoId, candidates: [] };
    },
    { connection: createRedisConnection() },
  );
}
