import { writeFile } from 'node:fs/promises';
import { VideoStatus } from '@viral-clip-app/database';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
} from '@viral-clip-app/shared';
import { Worker, type Job } from 'bullmq';
import { buildSrt, renderClip } from '../ffmpeg';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveClipOutputPath, reserveSrtPath } from '../storage';

export function createRenderClipWorker(): Worker<RenderClipJobData, RenderClipJobResult> {
  return new Worker<RenderClipJobData, RenderClipJobResult>(
    QueueName.RENDER_CLIP,
    async (job: Job<RenderClipJobData>) => {
      const { clipId, videoId, sourceUrl, startTime, endTime, transcript } = job.data;
      console.log(
        `[render-clip] rendering clip ${clipId} for video ${videoId} (${startTime}s - ${endTime}s)`,
      );

      let srtPath: string | null = null;

      try {
        const srtContent = buildSrt(transcript, startTime, endTime);
        if (srtContent.length > 0) {
          srtPath = await reserveSrtPath(clipId);
          await writeFile(srtPath, srtContent);
        }

        const outputPath = await reserveClipOutputPath(clipId);
        await renderClip({ sourceUrl, startTime, endTime, srtPath, outputPath });

        await prisma.clip.update({
          where: { id: clipId },
          data: { outputUrl: outputPath },
        });

        const siblingClips = await prisma.clip.findMany({ where: { videoId } });
        const allRendered = siblingClips.every((clip) => clip.outputUrl !== null);
        if (allRendered) {
          await prisma.video.update({
            where: { id: videoId },
            data: { status: VideoStatus.RENDERED },
          });
        }

        console.log(`[render-clip] clip ${clipId} -> ${outputPath}`);

        return { clipId, outputUrl: outputPath };
      } catch (error) {
        console.error(`[render-clip] clip ${clipId} failed:`, error);
        await prisma.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.FAILED },
        });
        throw error;
      } finally {
        if (srtPath) {
          await cleanupTempFile(srtPath);
        }
      }
    },
    { connection: createRedisConnection() },
  );
}
