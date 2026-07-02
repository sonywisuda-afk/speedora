import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { VideoStatus } from '@viral-clip-app/database';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
} from '@viral-clip-app/shared';
import { getObjectStream, uploadObject } from '@viral-clip-app/storage';
import { Worker, type Job } from 'bullmq';
import { buildSrt, renderClip } from '../ffmpeg';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveScratchPath } from '../storage';

export function createRenderClipWorker(): Worker<RenderClipJobData, RenderClipJobResult> {
  return new Worker<RenderClipJobData, RenderClipJobResult>(
    QueueName.RENDER_CLIP,
    async (job: Job<RenderClipJobData>) => {
      const { clipId, videoId, sourceUrl, startTime, endTime, transcript } = job.data;
      console.log(
        `[render-clip] rendering clip ${clipId} for video ${videoId} (${startTime}s - ${endTime}s)`,
      );

      let sourcePath: string | null = null;
      let srtPath: string | null = null;
      let outputPath: string | null = null;

      try {
        // ffmpeg needs a real local file to seek within - download the
        // source from object storage into scratch space first.
        sourcePath = await reserveScratchPath('source', path.extname(sourceUrl) || '.mp4');
        const sourceStream = await getObjectStream(sourceUrl);
        await pipeline(sourceStream, createWriteStream(sourcePath));

        const srtContent = buildSrt(transcript, startTime, endTime);
        if (srtContent.length > 0) {
          srtPath = await reserveScratchPath('captions', '.srt');
          await writeFile(srtPath, srtContent);
        }

        outputPath = await reserveScratchPath('output', '.mp4');
        await renderClip({ inputPath: sourcePath, startTime, endTime, srtPath, outputPath });

        const outputKey = `renders/${clipId}.mp4`;
        await uploadObject(outputKey, await readFile(outputPath), 'video/mp4');

        await prisma.clip.update({
          where: { id: clipId },
          data: { outputUrl: outputKey },
        });

        const siblingClips = await prisma.clip.findMany({ where: { videoId } });
        const allRendered = siblingClips.every((clip) => clip.outputUrl !== null);
        if (allRendered) {
          await prisma.video.update({
            where: { id: videoId },
            data: { status: VideoStatus.RENDERED },
          });
        }

        console.log(`[render-clip] clip ${clipId} -> ${outputKey}`);

        return { clipId, outputUrl: outputKey };
      } catch (error) {
        console.error(`[render-clip] clip ${clipId} failed:`, error);
        await prisma.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.FAILED },
        });
        throw error;
      } finally {
        if (sourcePath) await cleanupTempFile(sourcePath);
        if (srtPath) await cleanupTempFile(srtPath);
        if (outputPath) await cleanupTempFile(outputPath);
      }
    },
    { connection: createRedisConnection() },
  );
}
