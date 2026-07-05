import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import { VideoStatus } from '@speedora/database';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
  type TranscriptWord,
} from '@speedora/shared';
import { getObjectStream, uploadObject } from '@speedora/storage';
import { Worker, type Job } from 'bullmq';
import { stockAssetService } from '../assets/stockAssetService';
import {
  BROLL_DURATION_SECONDS,
  BROLL_FADE_SECONDS,
  downloadStockAsset,
  findBRollMoments,
} from '../broll';
import {
  computeFillerCuts,
  computeSilenceCuts,
  mergeCutRanges,
  totalCutSeconds,
  type CutRange,
} from '../cutlist';
import { detectFaces, type FaceSample } from '../faceDetection';
import {
  fadeOutBRoll,
  getVideoDimensions,
  renderClip,
  trimAndFadeInBRoll,
  trimCutRanges,
  type BRollOverlay,
  type ReframeOptions,
} from '../ffmpeg';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import {
  buildCropPath,
  buildSendCmdScript,
  computeCropDimensions,
  findEmphasisWords,
} from '../reframe';
import { cleanupTempFile, reserveScratchPath } from '../storage';
import { buildAss } from '../subtitles';

// Re-anchors a clip's transcript words onto the clip's own timeline (0 =
// this clip's start) - the convention shared by cutlist.ts's cut detection,
// buildAss's internal segment/word shift, FaceSample.t, and now
// findEmphasisWords/buildCropPath's zoom timing below.
function toClipRelativeWords(
  transcript: RenderClipJobData['transcript'],
  startTime: number,
): TranscriptWord[] {
  return transcript
    .flatMap((segment) => segment.words ?? [])
    .map((word) => ({ ...word, start: word.start - startTime, end: word.end - startTime }));
}

// Silence gaps and um/uh-family filler words to cut, computed from the
// clip's own transcript words - see cutlist.ts. Deliberately a *second*
// ffmpeg pass over the already-rendered (cropped + captioned) clip rather
// than folded into renderClip's own filtergraph: cuts are removed on the
// same clip-relative timeline renderClip's output already uses, so the
// burned-in captions/crop for a cut range simply vanish along with those
// exact frames - no separate timing remap needed for captions or the face-
// tracking crop path at all.
function computeClipCuts(
  transcript: RenderClipJobData['transcript'],
  startTime: number,
  endTime: number,
): CutRange[] {
  const words = toClipRelativeWords(transcript, startTime);

  return mergeCutRanges([
    ...computeSilenceCuts(words, endTime - startTime),
    ...computeFillerCuts(words),
  ]);
}

// Runs face detection and builds the crop/zoom plan for a clip. Never
// throws: a detection failure (missing/misbehaving Python subprocess, no
// face found, anything else) falls back to a static center-crop rather than
// failing the whole render - the same "don't fail the job just because
// there's no face to track" requirement extended to "don't fail the job
// because the face detector itself had a problem" (CLAUDE.md's Fase 2
// fallback decision).
async function buildReframePlan(
  sourcePath: string,
  startTime: number,
  endTime: number,
  transcript: RenderClipJobData['transcript'],
): Promise<ReframeOptions> {
  const { width: sourceWidth, height: sourceHeight } = await getVideoDimensions(sourcePath);
  const crop = computeCropDimensions(sourceWidth, sourceHeight);

  let samples: FaceSample[] = [];
  try {
    samples = await detectFaces(sourcePath, startTime, endTime);
  } catch (error) {
    console.warn('[render-clip] face detection failed, falling back to center-crop:', error);
  }

  const emphasisWords = findEmphasisWords(toClipRelativeWords(transcript, startTime));
  const cropPath = buildCropPath(
    samples,
    emphasisWords,
    crop,
    sourceWidth,
    sourceHeight,
    endTime - startTime,
  );
  if (!cropPath) {
    return {
      outputWidth: crop.width,
      outputHeight: crop.height,
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
    outputWidth: crop.width,
    outputHeight: crop.height,
    width: cropPath[0].width,
    height: cropPath[0].height,
    x: cropPath[0].x,
    y: cropPath[0].y,
    sendCmdPath,
  };
}

// Fase 15 (Auto B-roll) - finds up to a couple of keyword moments in this
// clip, and for each one that Pexels actually has stock footage for,
// prepares a ready-to-overlay cutaway (search -> download -> trim/scale/
// fade, see ffmpeg.ts's trimAndFadeInBRoll/fadeOutBRoll). Each moment is
// independent: one search/download/prep failure (no results from any
// provider, network error, a provider's rate limit, no API keys
// configured at all - StockAssetService.searchAssets returns null for
// that last case rather than throwing) just skips that ONE moment rather
// than the whole clip - same "don't fail the job over an optional signal"
// pattern as face detection/diarization/emotion detection elsewhere in
// this pipeline. Provider selection/fallback itself (Pexels -> Pixabay ->
// Unsplash, Fase 16's Adapter pattern) is entirely StockAssetService's
// concern - this function only ever sees the single normalized StockAsset
// it returns, never which provider it came from.
//
// Returns the finished overlay list AND every intermediate scratch path
// created along the way, separately - the raw download and the
// fade-in-only intermediate are cleaned up immediately per-moment (their
// job is done once fadeOutBRoll's output exists), but the FINAL per-overlay
// file has to survive until after renderClip() actually reads it, so the
// caller cleans those up itself once rendering is done.
async function buildBRollOverlays(
  keywords: string[],
  clipRelativeWords: TranscriptWord[],
  clipDurationSeconds: number,
  outputWidth: number,
  outputHeight: number,
): Promise<{ overlays: BRollOverlay[]; finalPaths: string[] }> {
  const moments = findBRollMoments(keywords, clipRelativeWords, clipDurationSeconds);
  const overlays: BRollOverlay[] = [];
  const finalPaths: string[] = [];

  for (const moment of moments) {
    let rawPath: string | null = null;
    let fadedInPath: string | null = null;
    try {
      const asset = await stockAssetService.searchAssets(moment.keyword);
      if (!asset) continue;

      // Extension doesn't functionally matter (trimAndFadeInBRoll forces
      // -f image2 explicitly for the 'image' case rather than relying on
      // it), just kept descriptive.
      rawPath = await reserveScratchPath('broll-raw', asset.type === 'image' ? '.jpg' : '.mp4');
      await downloadStockAsset(asset.url, rawPath);

      fadedInPath = await reserveScratchPath('broll-fadein', '.mov');
      await trimAndFadeInBRoll(
        rawPath,
        fadedInPath,
        outputWidth,
        outputHeight,
        BROLL_DURATION_SECONDS,
        BROLL_FADE_SECONDS,
        asset.type,
      );

      const finalPath = await reserveScratchPath('broll-final', '.mov');
      await fadeOutBRoll(fadedInPath, finalPath, BROLL_DURATION_SECONDS, BROLL_FADE_SECONDS);

      finalPaths.push(finalPath);
      overlays.push({
        filePath: finalPath,
        startTime: moment.t,
        endTime: moment.t + BROLL_DURATION_SECONDS,
      });
    } catch (error) {
      console.warn(`[render-clip] B-roll moment "${moment.keyword}" failed, skipping it:`, error);
    } finally {
      if (rawPath) await cleanupTempFile(rawPath);
      if (fadedInPath) await cleanupTempFile(fadedInPath);
    }
  }

  return { overlays, finalPaths };
}

export function createRenderClipWorker(): Worker<RenderClipJobData, RenderClipJobResult> {
  return new Worker<RenderClipJobData, RenderClipJobResult>(
    QueueName.RENDER_CLIP,
    async (job: Job<RenderClipJobData>) => {
      const { clipId, videoId, sourceUrl, startTime, endTime, transcript, captionStyle, keywords } =
        job.data;
      console.log(
        `[render-clip] rendering clip ${clipId} for video ${videoId} (${startTime}s - ${endTime}s)`,
      );

      let sourcePath: string | null = null;
      let subtitlesPath: string | null = null;
      let outputPath: string | null = null;
      let trimmedPath: string | null = null;
      let sendCmdPath: string | null = null;
      let brollPaths: string[] = [];

      try {
        // ffmpeg needs a real local file to seek within - download the
        // source from object storage into scratch space first.
        sourcePath = await reserveScratchPath('source', path.extname(sourceUrl) || '.mp4');
        const sourceStream = await getObjectStream(sourceUrl);
        await pipeline(sourceStream, createWriteStream(sourcePath));

        // Computed before captions - buildAss needs the final (post-crop,
        // post-scale) output dimensions to size/position the subtitle text
        // correctly.
        const reframe = await buildReframePlan(sourcePath, startTime, endTime, transcript);
        sendCmdPath = reframe.sendCmdPath;

        const { overlays: broll, finalPaths } = await buildBRollOverlays(
          keywords,
          toClipRelativeWords(transcript, startTime),
          endTime - startTime,
          reframe.outputWidth,
          reframe.outputHeight,
        );
        brollPaths = finalPaths;

        const assContent = buildAss({
          segments: transcript,
          clipStart: startTime,
          clipEnd: endTime,
          style: captionStyle,
          // outputWidth/outputHeight, NOT width/height - captions must be
          // sized against the clip's constant FINAL frame, not the crop
          // filter's t=0 declared size, which may already be a zoomed-in
          // (smaller) window if an emphasis word happens to start at t=0.
          videoWidth: reframe.outputWidth,
          videoHeight: reframe.outputHeight,
        });
        if (assContent.length > 0) {
          subtitlesPath = await reserveScratchPath('captions', '.ass');
          await writeFile(subtitlesPath, assContent);
        }

        outputPath = await reserveScratchPath('output', '.mp4');
        await renderClip({
          inputPath: sourcePath,
          startTime,
          endTime,
          subtitlesPath,
          outputPath,
          reframe,
          broll,
        });

        // Second pass (see computeClipCuts's comment) - skipped entirely
        // when there's nothing to cut, so a clip with no long pauses/filler
        // words renders exactly as it did before this feature existed.
        const cuts = computeClipCuts(transcript, startTime, endTime);
        let renderedPath = outputPath;
        if (cuts.length > 0) {
          trimmedPath = await reserveScratchPath('trimmed', '.mp4');
          const totalOutputDuration = endTime - startTime - totalCutSeconds(cuts);
          await trimCutRanges(outputPath, trimmedPath, cuts, totalOutputDuration);
          renderedPath = trimmedPath;
          console.log(
            `[render-clip] clip ${clipId}: removed ${totalCutSeconds(cuts).toFixed(1)}s of ` +
              `silence/filler across ${cuts.length} cut(s)`,
          );
        }

        const outputKey = `renders/${clipId}.mp4`;
        await uploadObject(outputKey, await readFile(renderedPath), 'video/mp4');

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
        // Tags only - never the transcript text or the source video itself.
        Sentry.captureException(error, { tags: { videoId, clipId } });
        await prisma.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.FAILED },
        });
        throw error;
      } finally {
        if (sourcePath) await cleanupTempFile(sourcePath);
        if (subtitlesPath) await cleanupTempFile(subtitlesPath);
        if (outputPath) await cleanupTempFile(outputPath);
        if (trimmedPath) await cleanupTempFile(trimmedPath);
        if (sendCmdPath) await cleanupTempFile(sendCmdPath);
        for (const brollPath of brollPaths) await cleanupTempFile(brollPath);
      }
    },
    { connection: createRedisConnection() },
  );
}
