import { Worker, type Job } from 'bullmq';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
} from '@viral-clip-app/shared';
import { createRedisConnection } from '../redis';

export function createRenderClipWorker(): Worker<RenderClipJobData, RenderClipJobResult> {
  return new Worker<RenderClipJobData, RenderClipJobResult>(
    QueueName.RENDER_CLIP,
    async (job: Job<RenderClipJobData>) => {
      const { clipId, videoId, startTime, endTime } = job.data;

      // TODO: cut the source video with FFmpeg and burn in captions from the transcript.
      console.log(
        `[render-clip] rendering clip ${clipId} for video ${videoId} (${startTime}s - ${endTime}s)`,
      );

      return { clipId, outputUrl: '' };
    },
    { connection: createRedisConnection() },
  );
}
