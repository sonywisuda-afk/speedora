import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import type { CaptionStyleValue, SpeakerTurn, SubtitleSegment } from '@speedora/contracts';
import {
  computeFillerCuts,
  computeSilenceCuts,
  mergeCutRanges,
  totalCutSeconds,
  type CutRange,
} from '@speedora/cutlist';
import { Prisma, updateVideoStatus, VideoStatus } from '@speedora/database';
import { computeHighlightScore, rankClips } from '@speedora/fusion-engine';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
  type TranscriptWord,
} from '@speedora/shared';
import { type AudioActivityWindow } from '@speedora/facial-intelligence';
import {
  onRenderGraphNodeFailure,
  renderClipGraph,
  runGraph,
  toClipUpdateData,
  toFusionInput,
  type RenderGraphContext,
  type RenderGraphResult,
} from '../render-graph';
import {
  buildCropPath,
  buildSendCmdScript,
  computeCropDimensions,
  detectFaces,
  findEmphasisWords,
  type FaceSample,
} from '@speedora/reframe';
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

// Batch 4 (Speaker Face Selection's "real" version) - a segment's own mean
// RMS at/above this reads as "audible speech happening" for
// speakerAudioSyncRate's purposes. A reasonable guess, not calibrated
// against real recordings (rmsDb itself is "not comparable across
// recordings" per TranscriptSegment's own caveat) - same honesty as every
// other threshold in this pipeline.
const SILENCE_RMS_DB_THRESHOLD = -40;

// Re-anchors transcript segments' own start/end onto the clip's timeline
// (same shift as toClipRelativeWords) into the narrow shape
// deriveFaceLandmarkFeatures actually needs - segments with no rmsDb
// measurement at all are dropped rather than guessed, so a gap in
// audio-timing coverage stays a gap (audioActiveAt returns null there),
// not a fabricated "no audio".
function toAudioActivityWindows(
  transcript: RenderClipJobData['transcript'],
  startTime: number,
): AudioActivityWindow[] {
  return transcript
    .filter((segment) => segment.rmsDb !== undefined)
    .map((segment) => ({
      start: segment.start - startTime,
      end: segment.end - startTime,
      hasAudio: segment.rmsDb! >= SILENCE_RMS_DB_THRESHOLD,
    }));
}

// Speaker Intelligence roadmap, Milestone A - re-anchors transcript
// segments' speaker labels onto the clip's timeline (same shift as
// toAudioActivityWindows) into @speedora/active-speaker-intelligence's
// SpeakerTurn[] input contract. Segments with no speaker label at all are
// dropped, not fabricated - same "a gap in coverage stays a gap" convention
// as toAudioActivityWindows above.
function toSpeakerTurns(
  transcript: RenderClipJobData['transcript'],
  startTime: number,
): SpeakerTurn[] {
  return transcript
    .filter((segment) => segment.speaker !== undefined)
    .map((segment) => ({
      speaker: segment.speaker!,
      start: segment.start - startTime,
      end: segment.end - startTime,
    }));
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
      // Same orphaned-job guard as transcribe/detect-clips workers - checked
      // against Clip rather than Video since this job's real unit of work is
      // one clip, and either the whole video (cascade) or just this one clip
      // (ClipsService.remove) being deleted while the job was still queued
      // makes it equally moot. Without this, a stale job would burn a full
      // render (source download, face/scene/facial/gesture detection,
      // FFmpeg) before failing on the final prisma.clip.update().
      const clipStillExists = await prisma.clip.count({ where: { id: clipId } });
      if (clipStillExists === 0) {
        console.log(`[render-clip] clip ${clipId} was deleted - skipping orphaned job`);
        return { clipId, outputUrl: '' };
      }

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

        // Composing multiple modules: the render-clip Feature Orchestrator (see
        // ARCHITECTURE.md) - Scene Intelligence's sceneCuts/sceneCutEvents are the first
        // signals migrated into the dependency graph (proof of concept), replacing their
        // own hand-written try/catch blocks with a declarative node pair
        // (render-graph/nodes/scene.ts). Every remaining detector/derive function below is
        // still the pre-graph inline code, migrated incrementally group by group.
        const renderGraphContext: RenderGraphContext = {
          clipId,
          sourcePath,
          startTime,
          endTime,
          transcript,
          scores,
          audioActivityWindows: toAudioActivityWindows(transcript, startTime),
          speakerTurns: toSpeakerTurns(transcript, startTime),
          reframe: { outputWidth: reframe.outputWidth, outputHeight: reframe.outputHeight },
        };
        const graphResult = (await runGraph(renderClipGraph, renderGraphContext, {
          onNodeFailure: onRenderGraphNodeFailure,
        })) as unknown as RenderGraphResult;
        // Every raw signal and derived feature that used to be a local `let`/`const` here
        // (sceneCuts, facialEmotions, faceLandmarks, sceneFeatures, speakerScores,
        // compositionFeatures, editingRhythmFeatures, ...) now lives on `graphResult` alone - see
        // render-graph/nodes/*.ts for each one's derivation and render-graph/sinks.ts for how
        // `graphResult` reaches computeHighlightScore()/prisma.clip.update() below.

        // Composing multiple modules: the render-clip Feature Orchestrator (see
        // ARCHITECTURE.md) - toFusionInput() replaces this call's former hand-written object
        // literal, translating each graph node's own id into computeHighlightScore's FUSION_SIGNALS
        // vocabulary via FUSION_INPUT_MAP (render-graph/sinks.ts) so the mapping lives in exactly
        // one place instead of being duplicated across this call and the prisma.clip.update() call
        // below.
        const highlight = computeHighlightScore(toFusionInput(graphResult, clipId, scores));

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

        // toClipUpdateData() replaces this call's former hand-written object literal the same way
        // toFusionInput() replaced computeHighlightScore's - see render-graph/sinks.ts's
        // CLIP_UPDATE_MAP for the per-node Prisma.JsonNull/plain-array/always-present rules, and
        // its own module comment for why this one needs a function-per-node table rather than
        // FUSION_INPUT_MAP's simpler plain rename table (speakerScores alone fans out to 4
        // columns). `extra` carries every field that isn't a graph node: outputUrl (render/upload
        // output, not an AI signal), llmFeatures (ClipScores is a closed interface with no index
        // signature, which Prisma's Json input type requires - same reasoning as
        // detect-clips.worker.ts's own scores write), and every highlight* field from
        // computeHighlightScore()'s own separate output above.
        await prisma.clip.update({
          where: { id: clipId },
          data: toClipUpdateData(graphResult, {
            outputUrl: outputKey,
            llmFeatures: (scores as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            highlightScore: highlight.highlightScore,
            highlightBreakdown: highlight.contributions,
            highlightExplainability: highlight.explainability,
            highlightConfidence: highlight.confidence,
            highlightReason: highlight.reason,
            highlightPrediction: highlight.prediction,
            highlightRecommendation: highlight.recommendation,
          }),
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
