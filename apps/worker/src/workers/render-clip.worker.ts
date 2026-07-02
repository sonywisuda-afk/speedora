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
import { detectFaces, type FaceSample } from '../faceDetection';
import { buildSrt, getVideoDimensions, renderClip, type ReframeOptions } from '../ffmpeg';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import { buildCropPath, buildSendCmdScript, computeCropDimensions } from '../reframe';
import { cleanupTempFile, reserveScratchPath } from '../storage';

// Runs face detection and builds the crop plan for a clip. Never throws:
// a detection failure (missing/misbehaving Python subprocess, no face
// found, anything else) falls back to a static center-crop rather than
// failing the whole render - the same "don't fail the job just because
// there's no face to track" requirement extended to "don't fail the job
// because the face detector itself had a problem" (CLAUDE.md's Fase 2
// fallback decision).
async function buildReframePlan(
  sourcePath: string,
  startTime: number,
  endTime: number,
): Promise<ReframeOptions> {
  const { width: sourceWidth, height: sourceHeight } = await getVideoDimensions(sourcePath);
  const crop = computeCropDimensions(sourceWidth, sourceHeight);

  let samples: FaceSample[] = [];
  try {
    samples = await detectFaces(sourcePath, startTime, endTime);
  } catch (error) {
    console.warn('[render-clip] face detection failed, falling back to center-crop:', error);
  }

  const cropPath = buildCropPath(samples, crop, sourceWidth, sourceHeight);
  if (!cropPath) {
    return {
      width: crop.width,
      height: crop.height,
      x: Math.round((sourceWidth - crop.width) / 2),
      y: Math.round((sourceHeight - crop.height) / 2),
      sendCmdPath: null,
    };
  }

  const sendCmdPath = await reserveScratchPath('reframe-cmds', '.txt');
  await writeFile(sendCmdPath, buildSendCmdScript(cropPath, 'crop@reframe'));
  return {
    width: crop.width,
    height: crop.height,
    x: cropPath[0].x,
    y: cropPath[0].y,
    sendCmdPath,
  };
}

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
      let sendCmdPath: string | null = null;

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

        const reframe = await buildReframePlan(sourcePath, startTime, endTime);
        sendCmdPath = reframe.sendCmdPath;

        outputPath = await reserveScratchPath('output', '.mp4');
        await renderClip({
          inputPath: sourcePath,
          startTime,
          endTime,
          srtPath,
          outputPath,
          reframe,
        });

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
        if (sendCmdPath) await cleanupTempFile(sendCmdPath);
      }
    },
    { connection: createRedisConnection() },
  );
}
