import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
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
import { Prisma, recordActivityEvent, updateVideoStatus, VideoStatus } from '@speedora/database';
import { computeHighlightScore, rankClips } from '@speedora/fusion-engine';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
  type TranscriptWord,
} from '@speedora/shared';
import { type AudioActivityWindow } from '@speedora/facial-intelligence';
import {
  renderClipGraph,
  runInstrumentedRenderGraph,
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
  extractBlurPlaceholder,
  extractThumbnail,
  fadeOutBRoll,
  getVideoDimensions,
  renderClip,
  trimAndFadeInBRoll,
  trimCutRanges,
  type BRollOverlay,
  type ReframeOptions,
} from '../ffmpeg';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveScratchPath } from '../storage';

const logger = forStage('render-clip');

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
    logger.warn('face detection failed, falling back to center-crop', {}, error);
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
      logger.warn('B-roll moment failed, skipping it', { keyword: moment.keyword }, error);
    } finally {
      if (rawPath) await cleanupTempFile(rawPath);
      if (fadedInPath) await cleanupTempFile(fadedInPath);
    }
  }

  return { overlays, finalPaths };
}

async function computeFileMd5Hex(filePath: string): Promise<string> {
  const hash = createHash('md5');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

// A single-part PutObjectCommand's ETag is exactly the MD5 hex digest of the
// uploaded bytes - a long-standing, broadly-implemented S3 behavior (true
// for both MinIO in dev and R2 in production, not an AWS-only quirk).
// Comparing it against a LOCALLY computed MD5 of the same file (see
// computeFileMd5Hex above) catches silent corruption - a truncated/partial
// write from a disk-full condition, a filesystem bug - that would otherwise
// get uploaded and later served to a real user indistinguishable from a
// correct render. Skipped (not treated as a mismatch, just unverified) when
// the ETag is missing or multipart-shaped (contains '-') - this project's
// uploads are never multipart, but a provider quirk producing one shouldn't
// be misread as corruption.
function verifyUploadChecksum(
  etag: string | undefined,
  expectedMd5Hex: string,
  clipId: string,
): void {
  if (!etag) {
    logger.warn('upload returned no ETag, skipping checksum verification', { clipId });
    return;
  }
  const normalized = etag.replace(/"/g, '');
  if (normalized.includes('-')) {
    logger.warn('multipart-shaped ETag, skipping checksum verification', { clipId });
    return;
  }
  if (normalized.toLowerCase() !== expectedMd5Hex.toLowerCase()) {
    throw new Error(
      `Uploaded clip ${clipId} failed checksum verification (local md5 ${expectedMd5Hex}, ` +
        `remote ETag ${normalized}) - possible corrupted upload`,
    );
  }
}

// Defense-in-depth outer bound (see jobTimeout.ts) - RENDER_TIMEOUT_MS (15m)
// + TRIM_TIMEOUT_MS (5m) from ffmpeg.ts, plus source download, B-roll
// fetches, and every detector in the render graph (several of which,
// unlike ffmpeg/diarization/vocal-emotion, have no timeout of their own
// yet - this outer bound is real coverage for those, not just redundant
// insurance).
const RENDER_CLIP_JOB_TIMEOUT_MS = 45 * 60 * 1000;

// Phase 3 (Hover Preview/Storyboard roadmap) - same fractions as
// transcribe.worker.ts's own storyboard (evenly spaced, excluding the very
// start/end).
const STORYBOARD_FRAME_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

export function createRenderClipWorker(): Worker<RenderClipJobData, RenderClipJobResult> {
  return new Worker<RenderClipJobData, RenderClipJobResult>(
    QueueName.RENDER_CLIP,
    (job: Job<RenderClipJobData>) =>
      withJobTimeout(
        async () => {
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
          const existingClip = await prisma.clip.findUnique({
            where: { id: clipId },
            // video.ownerId (Sprint 1-2, Dashboard Redesign) - needed for the
            // CLIP_GENERATED activity event below; fetched here rather than a
            // second round-trip later since this query already runs first.
            select: { outputUrl: true, video: { select: { ownerId: true } } },
          });
          if (!existingClip) {
            logger.info('clip was deleted - skipping orphaned job', { clipId, videoId });
            return { clipId, outputUrl: '' };
          }

          // Same idempotency reasoning as transcribe.worker.ts/detect-clips.worker.ts (see their own
          // comments) - a clip already having outputUrl set means some earlier execution of this same
          // job already finished the real work (source download, every detector, the full FFmpeg
          // render). Re-running it wastes CPU/time re-encoding an output nothing will read (the
          // existing file just gets overwritten), and - observed for real - two such re-runs landing
          // concurrently compete for the same CPU and can keep each other from ever finishing.
          if (existingClip.outputUrl) {
            logger.info('clip is already rendered - skipping duplicate job', { clipId, videoId });
            return { clipId, outputUrl: existingClip.outputUrl };
          }

          logger.info('rendering clip', { clipId, videoId, startTime, endTime });

          let sourcePath: string | null = null;
          let subtitlesPath: string | null = null;
          let outputPath: string | null = null;
          let trimmedPath: string | null = null;
          let sendCmdPath: string | null = null;
          let brollPaths: string[] = [];
          let thumbPath: string | null = null;
          let blurPath: string | null = null;
          const storyboardPaths: string[] = [];

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
            const graphResult = (await runInstrumentedRenderGraph(
              renderClipGraph,
              renderGraphContext,
            )) as unknown as RenderGraphResult;
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
              // Optional polish, not required for a correct clip - the untrimmed render above is
              // already a complete, valid output. Caught (not left to fail the whole job) for the same
              // "external ffmpeg call, bounded by TRIM_TIMEOUT_MS but still allowed to fail" reasoning
              // as every other optional signal in this file, prompted by a real timeout observed here.
              try {
                await trimCutRanges(outputPath, trimmedPath, cuts, totalOutputDuration);
                renderedPath = trimmedPath;
                logger.info('removed silence/filler cuts', {
                  clipId,
                  removedSeconds: Number(totalCutSeconds(cuts).toFixed(1)),
                  cutCount: cuts.length,
                });
              } catch (error) {
                logger.warn(
                  'silence/filler trim failed, keeping the untrimmed render',
                  { clipId },
                  error,
                );
              }
            }

            const outputKey = `renders/${clipId}.mp4`;
            // Computed before the upload, from the exact same local file the
            // upload is about to stream - see verifyUploadChecksum's comment.
            const expectedMd5 = await computeFileMd5Hex(renderedPath);
            // Sprint 1-2 (Dashboard Redesign) - the file's already on disk
            // (same file computeFileMd5Hex just streamed), so this costs
            // nothing extra. Feeds the Dashboard's per-owner Storage Used
            // stat - see Clip.outputSizeBytes.
            const { size: outputSizeBytes } = await stat(renderedPath);
            // Streamed straight from disk (not read into a Buffer first) - same
            // "no timeout at all on a plain readFile()" reasoning as
            // import-youtube.worker.ts's own upload, now applied here too. A
            // rendered clip can be tens to hundreds of MB, and this makes the
            // step subject to uploadObject's own requestTimeout instead of
            // being able to hang indefinitely.
            const etag = await uploadObject(outputKey, createReadStream(renderedPath), 'video/mp4');
            verifyUploadChecksum(etag, expectedMd5, clipId);

            // Product Experience roadmap - a Clip's gallery-card thumbnail.
            // Extracted from renderedPath (the FINAL rendered output, not the
            // raw source) so the thumbnail matches exactly what the viewer
            // will see - crop/captions/B-roll already burned in. Best-effort,
            // same "optional signal, never fails the job" idiom as the
            // silence/filler trim pass above: a failed extraction just leaves
            // thumbnailUrl unset in the update below (a retry that fails
            // extraction keeps whichever thumbnail a prior successful render
            // already set, rather than clobbering it with null).
            let thumbnailKey: string | null = null;
            let thumbnailBlurDataUrl: string | null = null;
            try {
              thumbPath = await reserveScratchPath('thumbnail', '.webp');
              await extractThumbnail(renderedPath, thumbPath, (endTime - startTime) / 2);
              thumbnailKey = `thumbnails/${clipId}.webp`;
              await uploadObject(thumbnailKey, createReadStream(thumbPath), 'image/webp');

              // Phase 2 (image optimization roadmap) - same "own best-effort
              // block, doesn't undo an otherwise-successful thumbnail" idiom
              // as transcribe.worker.ts's own blur placeholder extraction.
              try {
                blurPath = await reserveScratchPath('thumbnail-blur', '.webp');
                await extractBlurPlaceholder(renderedPath, blurPath, (endTime - startTime) / 2);
                const blurBuffer = await readFile(blurPath);
                thumbnailBlurDataUrl = `data:image/webp;base64,${blurBuffer.toString('base64')}`;
              } catch (error) {
                logger.warn(
                  'blur placeholder extraction failed, continuing without one',
                  { clipId },
                  error,
                );
              }
            } catch (error) {
              thumbnailKey = null;
              logger.warn('thumbnail extraction failed, continuing without one', { clipId }, error);
            }

            // Phase 3 (Hover Preview/Storyboard roadmap) - same "N evenly-spaced
            // frames, each its own independent best-effort extraction" idiom as
            // transcribe.worker.ts's own storyboard, extracted from
            // renderedPath (not the raw source) for the same "matches what the
            // viewer sees" reason as the thumbnail above.
            const storyboardKeys: string[] = [];
            for (let i = 0; i < STORYBOARD_FRAME_FRACTIONS.length; i++) {
              try {
                const framePath = await reserveScratchPath(`storyboard-${i}`, '.webp');
                storyboardPaths.push(framePath);
                await extractThumbnail(
                  renderedPath,
                  framePath,
                  (endTime - startTime) * STORYBOARD_FRAME_FRACTIONS[i],
                );
                const frameKey = `storyboards/${clipId}-${i}.webp`;
                await uploadObject(frameKey, createReadStream(framePath), 'image/webp');
                storyboardKeys.push(frameKey);
              } catch (error) {
                logger.warn(
                  'storyboard frame extraction failed, skipping this frame',
                  { clipId, frameIndex: i },
                  error,
                );
              }
            }

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
            //
            // The `where` clause's outputUrl: null is an optimistic-concurrency claim, not just a
            // filter - a clip's outputUrl starts null and this is the only write that ever sets it, so
            // "still null" means no other execution of this same job has finished first. Two renders
            // racing (observed for real: BullMQ stalled-job recovery re-running an already-finished
            // render concurrently with the original) now have only one winner; the loser's update
            // matches zero rows, which Prisma reports as P2025 (caught below as benign) instead of
            // silently overwriting the winner's result. The clip update and the conditional
            // "every sibling clip now rendered -> mark the video RENDERED" status transition are done
            // in one $transaction so a crash between them can never leave this clip rendered but its
            // video stuck one status behind (or vice-versa) - the video-status write is inlined here
            // (not updateVideoStatus(), which needs a full PrismaClient and opens its own nested
            // transaction) so it joins this SAME transaction, same "inlined to share one transaction"
            // convention as transcribe.worker.ts's own status write.
            let allRendered = false;
            try {
              allRendered = await prisma.$transaction(async (tx) => {
                await tx.clip.update({
                  where: { id: clipId, outputUrl: null },
                  data: toClipUpdateData(graphResult, {
                    outputUrl: outputKey,
                    outputSizeBytes,
                    ...(thumbnailKey ? { thumbnailUrl: thumbnailKey } : {}),
                    ...(thumbnailBlurDataUrl ? { thumbnailBlurDataUrl } : {}),
                    storyboardFrameUrls: storyboardKeys as unknown as Prisma.InputJsonValue,
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

                const siblingClips = await tx.clip.findMany({ where: { videoId } });
                const allDone = siblingClips.every((clip) => clip.outputUrl !== null);
                if (allDone) {
                  await tx.video.update({
                    where: { id: videoId },
                    data: { status: VideoStatus.RENDERED },
                  });
                  await tx.videoStatusEvent.create({
                    data: { videoId, toStatus: VideoStatus.RENDERED, errorMessage: null },
                  });
                }
                return allDone;
              });
            } catch (error) {
              if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                logger.info(
                  'clip was already claimed by another concurrent execution - skipping ' +
                    '(benign, same outcome as the early idempotency check above)',
                  { clipId },
                );
                return { clipId, outputUrl: outputKey };
              }
              throw error;
            }

            // Sprint 1-2 (Dashboard Redesign) - Dashboard's Activity Timeline.
            // Best-effort: never rethrown, same "a secondary feed's write must
            // never fail the primary action" posture as videos.service.ts's
            // own VIDEO_UPLOADED event.
            await recordActivityEvent(prisma, {
              userId: existingClip.video.ownerId,
              type: 'CLIP_GENERATED',
              videoId,
              clipId,
            }).catch((error) => {
              logger.warn('failed to record CLIP_GENERATED activity event', { clipId }, error);
            });

            if (allRendered) {
              // Ranking (Fase 31) - only meaningful once every clip in the
              // video has a highlightScore to compare against its siblings.
              // Never fails the render job itself: ranking is a pure/
              // synchronous helper over data that's already just been written,
              // and a failure here would be surprising, but is still wrapped
              // defensively since it runs after the clip's own render is
              // already a done deal. Deliberately outside the transaction above
              // (unchanged) - ranking is independently fault-tolerant by design
              // and doesn't need to be atomic with the render/status write.
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
                logger.warn(
                  'ranking sibling clips failed, continuing without highlightRank',
                  { videoId },
                  error,
                );
              }
            }

            logger.info('clip rendered', { clipId, outputUrl: outputKey });

            return { clipId, outputUrl: outputKey };
          } catch (error) {
            logger.error('clip failed', { clipId, videoId }, error);
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
            if (thumbPath) await cleanupTempFile(thumbPath);
            if (blurPath) await cleanupTempFile(blurPath);
            for (const storyboardPath of storyboardPaths) await cleanupTempFile(storyboardPath);
            for (const brollPath of brollPaths) await cleanupTempFile(brollPath);
          }
        },
        RENDER_CLIP_JOB_TIMEOUT_MS,
        `render-clip:${job.data.clipId}`,
      ),
    {
      connection: createRedisConnection(),
      // Explicit, not the implicit default - same "one at a time per worker
      // process, raise only after a real capacity-planning decision" reasoning
      // as transcribe.worker.ts. Especially load-bearing here: this job's own
      // subprocess concurrency limiter (subprocessLimiter.ts) caps
      // system-wide FFmpeg/Python contention, but only across whatever jobs
      // are actually running - raising this above 1 without also revisiting
      // that limiter's ceiling would just move the contention problem rather
      // than fix it.
      concurrency: 1,
      // Comfortably above this job's worst-case real duration (source
      // download + every detector + up to RENDER_TIMEOUT_MS's 15 minutes of
      // FFmpeg encoding + the trim pass) - same BullMQ stalled-job
      // mis-detection reasoning as transcribe.worker.ts. This is the exact
      // job that raced itself for CPU tonight after being mistaken for
      // stalled.
      lockDuration: 20 * 60 * 1000,
    },
  );
}
