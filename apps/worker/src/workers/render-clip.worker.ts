import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import type { CaptionStyleValue, SubtitleSegment } from '@speedora/contracts';
import {
  computeFillerCuts,
  computeSilenceCuts,
  mergeCutRanges,
  totalCutSeconds,
  type CutRange,
} from '@speedora/cutlist';
import { deriveAudioFeatures } from '@speedora/audio-intelligence';
import { Prisma, updateVideoStatus, VideoStatus } from '@speedora/database';
import { computeHighlightScore, rankClips } from '@speedora/fusion-engine';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
  type TranscriptWord,
} from '@speedora/shared';
import {
  deriveFacialEmotionFeatures,
  detectFacialEmotion,
  type FacialEmotionSample,
} from '@speedora/facial-intelligence';
import {
  deriveGestureFeatures,
  detectGestures,
  type GestureSample,
} from '@speedora/gesture-intelligence';
import {
  buildCropPath,
  buildSendCmdScript,
  computeCropDimensions,
  detectFaces,
  findEmphasisWords,
  type FaceSample,
} from '@speedora/reframe';
import { deriveSceneFeatures, detectSceneCuts } from '@speedora/scene-intelligence';
import { getObjectStream, uploadObject } from '@speedora/storage';
import { buildAss } from '@speedora/subtitles';
import { Worker, type Job } from 'bullmq';
import { stockAssetService } from '../assets/stockAssetService';
import {
  BROLL_DURATION_SECONDS,
  BROLL_FADE_SECONDS,
  downloadStockAsset,
  findBRollMoments,
} from '../broll';
import { faceDetectionDeps } from '../faceDetectionDeps';
import { facialIntelligenceDeps } from '../facialIntelligenceDeps';
import {
  fadeOutBRoll,
  getVideoDimensions,
  renderClip,
  trimAndFadeInBRoll,
  trimCutRanges,
  type BRollOverlay,
  type ReframeOptions,
} from '../ffmpeg';
import { gestureIntelligenceDeps } from '../gestureIntelligenceDeps';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import { sceneIntelligenceDeps } from '../sceneIntelligenceDeps';
import { cleanupTempFile, reserveScratchPath } from '../storage';

// Re-anchors a clip's transcript words onto the clip's own timeline (0 =
// this clip's start) - the convention shared by @speedora/cutlist's cut
// detection, @speedora/subtitles's internal segment/word shift, FaceSample.t,
// and now findEmphasisWords/buildCropPath's zoom timing below.
function toClipRelativeWords(
  transcript: RenderClipJobData['transcript'],
  startTime: number,
): TranscriptWord[] {
  return transcript
    .flatMap((segment) => segment.words ?? [])
    .map((word) => ({ ...word, start: word.start - startTime, end: word.end - startTime }));
}

// Narrows a DB-shaped TranscriptSegment (which also carries speaker/emotion
// labels @speedora/subtitles never reads) down to that module's own,
// smaller input contract - same pattern as detect-clips.worker.ts's
// toScoringInput() for @speedora/clip-scoring.
function toSubtitleSegments(transcript: RenderClipJobData['transcript']): SubtitleSegment[] {
  return transcript.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
    words: segment.words,
  }));
}

// Silence gaps and um/uh-family filler words to cut, computed from the
// clip's own transcript words - see @speedora/cutlist. Deliberately a *second*
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
    samples = await detectFaces({ sourcePath, startTime, endTime }, faceDetectionDeps);
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
      const {
        clipId,
        videoId,
        sourceUrl,
        startTime,
        endTime,
        transcript,
        captionStyle,
        keywords,
        scores,
      } = job.data;
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

        // Scene Intelligence (Fase 26, Phase B of the AI Fusion roadmap) -
        // hard shot/scene cuts within this clip's own time range. Never
        // fails the job, same "optional signal" pattern as face detection
        // above - a failed/empty analysis just leaves sceneCuts as [].
        let sceneCuts: number[] = [];
        try {
          const result = await detectSceneCuts(
            { videoPath: sourcePath, startTime, endTime },
            sceneIntelligenceDeps,
          );
          sceneCuts = result.cuts;
        } catch (error) {
          console.warn(
            `[render-clip] scene cut detection failed for clip ${clipId}, continuing without ` +
              'scene data:',
            error,
          );
        }

        // Facial Intelligence (Fase 27, Phase C of the AI Fusion roadmap) -
        // per-sampled-frame facial expression within this clip's own time
        // range. Never fails the job, same "optional signal" pattern as
        // face detection/scene cuts above - a failed analysis just leaves
        // facialEmotions as null (distinct from an empty array, which would
        // mean "ran successfully and found nothing").
        let facialEmotions: FacialEmotionSample[] | null = null;
        try {
          facialEmotions = await detectFacialEmotion(
            { sourcePath, startTime, endTime },
            facialIntelligenceDeps,
          );
        } catch (error) {
          console.warn(
            `[render-clip] facial emotion detection failed for clip ${clipId}, continuing ` +
              'without facial emotion data:',
            error,
          );
        }

        // Gesture Intelligence (Fase 30, Phase D / Checkpoint 2 of the AI
        // Fusion roadmap) - same "never fails the job" pattern as facial
        // emotion above.
        let gestures: GestureSample[] | null = null;
        try {
          gestures = await detectGestures(
            { sourcePath, startTime, endTime },
            gestureIntelligenceDeps,
          );
        } catch (error) {
          console.warn(
            `[render-clip] gesture detection failed for clip ${clipId}, continuing without ` +
              'gesture data:',
            error,
          );
        }

        // Mini Fusion Engine v1/v2 prep (Fase 28/30, Checkpoint 1/2 of the
        // AI Fusion roadmap) - dense derived summaries computed from the
        // raw signals above (see packages/contracts/src/intelligence-
        // signal.ts's raw/features convention). sceneFeatures/
        // audioFeatures are always computed (their raw inputs are always
        // arrays, even if empty); facialFeatures/gestureFeatures are null
        // exactly when facialEmotions/gestures are null (total analysis
        // failure), matching those fields' own null-vs-empty-array
        // distinction rather than fabricating a summary from nothing.
        const sceneFeatures = deriveSceneFeatures(sceneCuts, endTime - startTime);
        const facialFeatures = facialEmotions ? deriveFacialEmotionFeatures(facialEmotions) : null;
        const gestureFeatures = gestures ? deriveGestureFeatures(gestures) : null;
        const audioFeatures = deriveAudioFeatures(
          transcript.map((segment) => ({
            rmsDb: segment.rmsDb ?? null,
            peakDb: segment.peakDb ?? null,
            speakingRateWordsPerSecond: segment.speakingRateWordsPerSecond ?? null,
          })),
        );

        // Mini Fusion Engine v2 (Fase 29/31) - combines whichever of the
        // features above are actually available into one explainable,
        // weighted, confidence-scored 0-100 highlightScore (see
        // @speedora/fusion-engine). Pure/synchronous, no try/catch needed
        // here - it never throws for missing signals (see
        // fusionInputSchema's .optional() fields), only for a malformed
        // input shape, which can't happen given the values constructed
        // just above.
        const highlight = computeHighlightScore({
          clipId,
          audio: audioFeatures,
          scene: sceneFeatures,
          facial: facialFeatures ?? undefined,
          gesture: gestureFeatures ?? undefined,
          // Fase 32 - the clip's own Fase 8 Content Intelligence scores,
          // threaded through the job payload (see RenderClipJobData) rather
          // than re-queried here, same "payload carries what the adapter
          // already computed" convention as keywords/transcript above.
          llm: scores ?? undefined,
        });

        const { overlays: broll, finalPaths } = await buildBRollOverlays(
          keywords,
          toClipRelativeWords(transcript, startTime),
          endTime - startTime,
          reframe.outputWidth,
          reframe.outputHeight,
        );
        brollPaths = finalPaths;

        const assContent = buildAss({
          segments: toSubtitleSegments(transcript),
          clipStart: startTime,
          clipEnd: endTime,
          // CaptionStyle (packages/database's Prisma enum, re-exported by
          // packages/shared) and CaptionStyleValue (packages/contracts'
          // plain string-literal union) share the exact same runtime string
          // values by convention - this cast is safe, not a type escape
          // hatch, and is the one place that convention is load-bearing.
          style: captionStyle as CaptionStyleValue,
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
          data: {
            outputUrl: outputKey,
            sceneCuts,
            // Prisma.JsonNull, not plain `null` - a nullable Json column
            // needs this sentinel to write an actual SQL NULL rather than
            // being ambiguous with "field not provided" (same reasoning
            // Prisma applies to every other Json? column in this schema).
            facialEmotions: facialEmotions ?? Prisma.JsonNull,
            gestures: gestures ?? Prisma.JsonNull,
            audioFeatures,
            sceneFeatures,
            facialFeatures: facialFeatures ?? Prisma.JsonNull,
            gestureFeatures: gestureFeatures ?? Prisma.JsonNull,
            // ClipScores is a closed interface (no index signature), which
            // Prisma's Json input type requires - same reasoning as
            // detect-clips.worker.ts's own scores write.
            llmFeatures: (scores as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            highlightScore: highlight.highlightScore,
            highlightBreakdown: highlight.contributions,
            highlightExplainability: highlight.explainability,
            highlightConfidence: highlight.confidence,
            highlightReason: highlight.reason,
            highlightPrediction: highlight.prediction,
            highlightRecommendation: highlight.recommendation,
          },
        });

        const siblingClips = await prisma.clip.findMany({ where: { videoId } });
        const allRendered = siblingClips.every((clip) => clip.outputUrl !== null);
        if (allRendered) {
          await updateVideoStatus(prisma, videoId, VideoStatus.RENDERED);

          // Ranking (Fase 31) - only meaningful once every clip in the
          // video has a highlightScore to compare against its siblings.
          // Never fails the render job itself: ranking is a pure/
          // synchronous helper over data that's already just been written,
          // and a failure here would be surprising, but is still wrapped
          // defensively since it runs after the clip's own render is
          // already a done deal.
          try {
            const scoredSiblings = await prisma.clip.findMany({
              where: { videoId },
              select: { id: true, highlightScore: true },
            });
            const ranked = rankClips(
              scoredSiblings.map((clip) => ({
                clipId: clip.id,
                highlightScore: clip.highlightScore,
              })),
            );
            await Promise.all(
              ranked.map((clip) =>
                prisma.clip.update({
                  where: { id: clip.clipId },
                  data: { highlightRank: clip.rank },
                }),
              ),
            );
          } catch (error) {
            console.warn(
              `[render-clip] ranking sibling clips of video ${videoId} failed, continuing ` +
                'without highlightRank:',
              error,
            );
          }
        }

        console.log(`[render-clip] clip ${clipId} -> ${outputKey}`);

        return { clipId, outputUrl: outputKey };
      } catch (error) {
        console.error(`[render-clip] clip ${clipId} failed:`, error);
        // Tags only - never the transcript text or the source video itself.
        Sentry.captureException(error, { tags: { videoId, clipId } });
        await updateVideoStatus(prisma, videoId, VideoStatus.FAILED, {
          errorMessage: error instanceof Error ? error.message : String(error),
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
