import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import type {
  CaptionStyleValue,
  OcrTextTrack,
  SpeakerTurn,
  SubtitleSegment,
} from '@speedora/contracts';
import {
  computeFillerCuts,
  computeSilenceCuts,
  mergeCutRanges,
  totalCutSeconds,
  type CutRange,
} from '@speedora/cutlist';
import {
  associateSpeakersWithFaces,
  detectActiveSpeaker,
  verifyLipSync,
} from '@speedora/active-speaker-intelligence';
import { deriveAudioFeatures } from '@speedora/audio-intelligence';
import { Prisma, updateVideoStatus, VideoStatus } from '@speedora/database';
import { deriveEditingRhythmFeatures } from '@speedora/editing-rhythm';
import { computeHighlightScore, rankClips } from '@speedora/fusion-engine';
import { buildSpeakerTimeline, detectSpeakerTransitions } from '@speedora/speaker-diarization';
import { deriveClipSpeakerScores, deriveSpeakerFusionFeatures } from '@speedora/speaker-scoring';
import {
  QueueName,
  type RenderClipJobData,
  type RenderClipJobResult,
  type TranscriptWord,
} from '@speedora/shared';
import {
  deriveFaceLandmarkFeatures,
  deriveFacialEmotionFeatures,
  deriveTrackingQualityMetrics,
  detectFaceLandmarks,
  detectFacialEmotion,
  type AudioActivityWindow,
  type FaceLandmarkSample,
  type FacialEmotionSample,
} from '@speedora/facial-intelligence';
import {
  deriveGestureFeatures,
  detectGestures,
  type GestureSample,
} from '@speedora/gesture-intelligence';
import {
  deriveObjectFeatures,
  detectObjects,
  trackObjects,
  type ObjectSample,
} from '@speedora/object-intelligence';
import {
  classifyOcrTrack,
  deriveOcrFeatures,
  detectOcrText,
  trackOcrText,
  type FaceBoundingBoxSample,
  type OcrSample,
} from '@speedora/ocr-intelligence';
import {
  buildCropPath,
  buildSendCmdScript,
  computeCropDimensions,
  detectFaces,
  findEmphasisWords,
  type FaceSample,
} from '@speedora/reframe';
import {
  analyzeMotionEnergy,
  classifySceneCutTypes,
  deriveCameraMotionFeatures,
  deriveMotionEnergyFeatures,
  deriveSceneFeatures,
  detectCameraMotion,
  detectSceneCuts,
  type CameraMotionSample,
  type MotionEnergySample,
  type SceneCutEvent,
} from '@speedora/scene-intelligence';
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
import { cameraMotionDeps } from '../cameraMotionDeps';
import { faceDetectionDeps } from '../faceDetectionDeps';
import { faceLandmarksDeps } from '../faceLandmarksDeps';
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
import { objectIntelligenceDeps } from '../objectIntelligenceDeps';
import { ocrIntelligenceDeps } from '../ocrIntelligenceDeps';
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

// OCR initiative Batch OCR-2 - narrows @speedora/facial-intelligence's
// FaceLandmarkSample[] down to @speedora/ocr-intelligence's own
// FaceBoundingBoxSample[] input contract for the `nearFace` feature (same
// "narrow input contract flowing across module boundaries" pattern as
// toAudioActivityWindows above) - samples with no detected face at all
// are dropped, not fabricated.
function toFaceBoundingBoxes(faceLandmarks: FaceLandmarkSample[]): FaceBoundingBoxSample[] {
  return faceLandmarks
    .filter(
      (
        sample,
      ): sample is FaceLandmarkSample & {
        boundingBox: NonNullable<FaceLandmarkSample['boundingBox']>;
      } => sample.boundingBox !== null,
    )
    .map((sample) => ({ t: sample.t, boundingBox: sample.boundingBox }));
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

        // Batch SC-1 (Scene Intelligence taxonomy expansion, on top of the
        // detection above) - classifies whichever cuts were just found as
        // hard cuts vs. fades. Null (not []) when classification wasn't run
        // or failed entirely, distinct from an empty array (no cuts to
        // classify) - same "never fails the job" pattern as every detector
        // above, even though classifySceneCutTypes already catches its own
        // ffmpeg failures internally (defense in depth, same as
        // detectSceneCuts's own wrapping here).
        let sceneCutEvents: SceneCutEvent[] | null = null;
        try {
          const result = await classifySceneCutTypes(
            { videoPath: sourcePath, startTime, endTime, cuts: sceneCuts },
            sceneIntelligenceDeps,
          );
          sceneCutEvents = result.events;
        } catch (error) {
          console.warn(
            `[render-clip] scene cut type classification failed for clip ${clipId}, continuing ` +
              'without cut-type data:',
            error,
          );
        }

        // Batch SC-2 (Scene Intelligence taxonomy expansion, continuing
        // Batch SC-1) - a SEPARATE signal from cuts above (motion
        // magnitude/Static-Dynamic Scene classification, not cut events).
        // Never fails the job, same pattern as every detector above -
        // analyzeMotionEnergy already catches its own ffmpeg failures
        // internally (defense in depth, same as detectSceneCuts's own
        // wrapping here).
        let motionEnergy: MotionEnergySample[] = [];
        try {
          const result = await analyzeMotionEnergy(
            { videoPath: sourcePath, startTime, endTime },
            sceneIntelligenceDeps,
          );
          motionEnergy = result.samples;
        } catch (error) {
          console.warn(
            `[render-clip] motion energy analysis failed for clip ${clipId}, continuing without ` +
              'motion data:',
            error,
          );
        }

        // Batch SC-3 (Scene Intelligence taxonomy expansion, continuing
        // Batch SC-1/SC-2) - DIRECTIONAL camera motion (pan/tilt/zoom/
        // shake), a SEPARATE signal from motionEnergy above (undirected
        // magnitude). A Python/OpenCV subprocess (unlike motionEnergy's
        // ffmpeg-based analyzeMotionEnergy), so it follows facialEmotions/
        // gestures' "module throws, adapter catches" pattern instead of
        // catching its own failures internally.
        let cameraMotion: CameraMotionSample[] | null = null;
        try {
          cameraMotion = await detectCameraMotion(
            { sourcePath, startTime, endTime },
            cameraMotionDeps,
          );
        } catch (error) {
          console.warn(
            `[render-clip] camera motion detection failed for clip ${clipId}, continuing ` +
              'without camera motion data:',
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

        // Face Intelligence initiative Batch 1 (AI Fusion roadmap) - same
        // "never fails the job" pattern as facial emotion/gesture above.
        // Distinct subprocess/model from facial emotion (MediaPipe
        // FaceLandmarker vs. a ViT expression classifier) - see
        // detect_face_landmarks.py's module comment.
        let faceLandmarks: FaceLandmarkSample[] | null = null;
        try {
          faceLandmarks = await detectFaceLandmarks(
            { sourcePath, startTime, endTime },
            faceLandmarksDeps,
          );
        } catch (error) {
          console.warn(
            `[render-clip] face landmark detection failed for clip ${clipId}, continuing ` +
              'without face landmark data:',
            error,
          );
        }

        // OCR initiative Batch OCR-1 (AI Fusion roadmap) - same "never
        // fails the job" pattern as every other detector above. Raw
        // detection only (text + bounding box + confidence per sampled
        // frame) - no derived/classified features yet (that's OCR-2's
        // cross-frame tracking + rule-based Subtitle/Slide/Caption/Logo/
        // Price/Name classification), so there's no `ocrFeatures`
        // counterpart to compute here, unlike every other signal below.
        let ocrText: OcrSample[] | null = null;
        try {
          ocrText = await detectOcrText({ sourcePath, startTime, endTime }, ocrIntelligenceDeps);
        } catch (error) {
          console.warn(
            `[render-clip] OCR text detection failed for clip ${clipId}, continuing without ` +
              'OCR data:',
            error,
          );
        }

        // Object Intelligence roadmap, Batch OI-1 (Foundation) - same
        // "never fails the job" pattern as every other MediaPipe-based
        // detector above.
        let objects: ObjectSample[] | null = null;
        try {
          objects = await detectObjects({ sourcePath, startTime, endTime }, objectIntelligenceDeps);
        } catch (error) {
          console.warn(
            `[render-clip] object detection failed for clip ${clipId}, continuing without ` +
              'object data:',
            error,
          );
        }

        // Mini Fusion Engine v1/v2 prep (Fase 28/30, Checkpoint 1/2 of the
        // AI Fusion roadmap) - dense derived summaries computed from the
        // raw signals above (see packages/contracts/src/intelligence-
        // signal.ts's raw/features convention). sceneFeatures/
        // audioFeatures are always computed (their raw inputs are always
        // arrays, even if empty); facialFeatures/gestureFeatures/
        // faceLandmarkFeatures are null exactly when their raw signal is
        // null (total analysis failure), matching those fields' own
        // null-vs-empty-array distinction rather than fabricating a
        // summary from nothing.
        const sceneFeatures = deriveSceneFeatures(
          sceneCuts,
          endTime - startTime,
          sceneCutEvents ?? [],
        );
        // Batch SC-2 - always computed (motionEnergy is always an array,
        // even if empty), same convention as sceneFeatures above. Batch
        // SC-5 added the clipDurationSeconds parameter (peakRatePerMinute).
        const motionEnergyFeatures = deriveMotionEnergyFeatures(motionEnergy, endTime - startTime);
        // Batch SC-3 - null exactly when cameraMotion is null, same
        // convention as facialFeatures/gestureFeatures below.
        const cameraMotionFeatures = cameraMotion ? deriveCameraMotionFeatures(cameraMotion) : null;
        const facialFeatures = facialEmotions ? deriveFacialEmotionFeatures(facialEmotions) : null;
        const gestureFeatures = gestures ? deriveGestureFeatures(gestures) : null;
        const faceLandmarkFeatures = faceLandmarks
          ? deriveFaceLandmarkFeatures(faceLandmarks, toAudioActivityWindows(transcript, startTime))
          : null;
        // Batch 4.5 (Quality Metrics & Telemetry) - explainability/audit
        // telemetry over faceLandmarks' own tracking, NOT fed into
        // computeHighlightScore below (explicitly not a scoring signal,
        // see @speedora/contracts' faceTrackingQualityMetricsSchema).
        const trackingQualityMetrics = faceLandmarks
          ? deriveTrackingQualityMetrics(faceLandmarks)
          : null;
        // Speaker Intelligence roadmap, Milestone A - pure aggregations
        // over faceLandmarks + this clip's own transcript audio timing/
        // speaker labels (no new subprocess) - null exactly when
        // faceLandmarks is null, same convention as trackingQualityMetrics
        // above. Not yet consumed by computeHighlightScore below, same
        // "collected, not yet wired into Fusion" status as
        // trackingQualityMetrics (though unlike that column, these ARE
        // intended to eventually feed scoring - see
        // docs/ai/speaker-intelligence.md's speakerFusionFeaturesSchema).
        const speakerTurnsInClip = toSpeakerTurns(transcript, startTime);
        const activeSpeakerSamples = faceLandmarks
          ? detectActiveSpeaker(faceLandmarks, toAudioActivityWindows(transcript, startTime))
          : null;
        const speakerFaceAssociations = activeSpeakerSamples
          ? associateSpeakersWithFaces(speakerTurnsInClip, activeSpeakerSamples)
          : null;
        const lipSyncVerifications = faceLandmarks
          ? verifyLipSync(faceLandmarks, toAudioActivityWindows(transcript, startTime))
          : null;
        // Speaker Intelligence roadmap, Milestone B - fuses this clip's own
        // speaker turns with the Milestone A signals just above into one
        // unified timeline. Unlike activeSpeakerSamples/
        // speakerFaceAssociations, this does NOT depend on faceLandmarks
        // having succeeded - it degrades to faceTrackId/isActiveOnScreen
        // all-null entries (via buildSpeakerTimeline's own null-safe
        // lookups) rather than being null itself, since "who's talking
        // when" is meaningful even with zero face-tracking data. Null only
        // when there are no speaker turns covering this clip's time range
        // at all.
        const speakerTimeline =
          speakerTurnsInClip.length > 0
            ? buildSpeakerTimeline(
                speakerTurnsInClip,
                speakerFaceAssociations ?? [],
                activeSpeakerSamples ?? [],
              )
            : null;
        const speakerTimelineFeatures =
          speakerTurnsInClip.length > 0 ? detectSpeakerTransitions(speakerTurnsInClip) : null;
        // Speaker Intelligence roadmap, Milestone C - Speaker Confidence/
        // Engagement/Importance and per-turn Highlight Moments, scoped to
        // each speaker in speakerTimeline. Reuses the SAME transcript
        // (already has each segment's own speaker/rmsDb/peakDb/
        // speakingRateWordsPerSecond) and faceLandmarks this adapter
        // already has in scope - no new detection. hookStrength comes from
        // this clip's own LLM scores (clip-level, not moment-level - see
        // @speedora/speaker-scoring's own comment on that limitation).
        // Null when speakerTimeline itself is null (nothing to score).
        const speakerScores = speakerTimeline
          ? deriveClipSpeakerScores({
              speakerTimeline,
              faceLandmarks: faceLandmarks ?? [],
              audioActivity: toAudioActivityWindows(transcript, startTime),
              transcriptSegments: transcript.map((segment) => ({
                speaker: segment.speaker,
                rmsDb: segment.rmsDb ?? null,
                peakDb: segment.peakDb ?? null,
                speakingRateWordsPerSecond: segment.speakingRateWordsPerSecond ?? null,
              })),
              gestureFeatures,
              clipDurationSeconds: endTime - startTime,
              hookStrength: scores?.hookStrength ?? null,
            })
          : null;
        // OCR initiative Batch OCR-2 - cross-frame tracking + rule-based
        // classification over Batch OCR-1's own raw ocrText (see
        // @speedora/ocr-intelligence's own module comments for why this
        // is pure TypeScript, not a Python-script change). nearFace
        // resolves to null on every track (not false) when faceLandmarks
        // itself is null - "no face data supplied at all" per
        // trackOcrText's own contract, same distinction
        // speakerAudioSyncRate already makes for audio data.
        const ocrTracks: OcrTextTrack[] | null = ocrText
          ? trackOcrText(ocrText, faceLandmarks ? toFaceBoundingBoxes(faceLandmarks) : []).map(
              classifyOcrTrack,
            )
          : null;
        const ocrFeatures = ocrText ? deriveOcrFeatures(ocrTracks ?? [], ocrText.length) : null;
        // Object Intelligence roadmap, Batch OI-1 - cross-frame tracking
        // over Batch OI-1's own raw `objects` (see
        // @speedora/object-intelligence's trackObjects() module comment for
        // why this generalizes OCR's tracker, not Face Intelligence's
        // single-track one, into a genuine multi-object tracker). Same
        // "raw/tracks/features" three-layer pattern as ocrText/ocrTracks/
        // ocrFeatures above.
        const objectTracks = objects ? trackObjects(objects) : null;
        const objectFeatures = objects
          ? deriveObjectFeatures(objectTracks ?? [], objects.length)
          : null;
        const audioFeatures = deriveAudioFeatures(
          transcript.map((segment) => ({
            rmsDb: segment.rmsDb ?? null,
            peakDb: segment.peakDb ?? null,
            speakingRateWordsPerSecond: segment.speakingRateWordsPerSecond ?? null,
          })),
        );

        // Taxonomy category F (Editing Rhythm) - a COMPOSITE signal, per
        // explicit user architectural rule: its own package
        // (@speedora/editing-rhythm) combines OTHER signals' already-
        // computed output (sceneCuts/motionEnergy raw timelines, plus the
        // sceneFeatures/motionEnergyFeatures/audioFeatures aggregates just
        // computed above) rather than running a fresh subprocess/ffmpeg
        // call of its own. Always computed (never wrapped in try/catch) -
        // deriveEditingRhythmFeatures is pure/synchronous and degrades
        // gracefully to null fields on missing data, same as every other
        // deriveXFeatures in this pipeline.
        const editingRhythmFeatures = deriveEditingRhythmFeatures({
          clipDurationSeconds: endTime - startTime,
          sceneCuts,
          motionEnergySamples: motionEnergy,
          cutsPerMinute: sceneFeatures.cutsPerMinute,
          averageMotionEnergy: motionEnergyFeatures.averageMotionEnergy,
          averageSpeakingRateWordsPerSecond: audioFeatures.averageSpeakingRateWordsPerSecond,
        });

        // Mini Fusion Engine v2 (Fase 29/31) - combines whichever of the
        // features above are actually available into one explainable,
        // weighted, confidence-scored 0-100 highlightScore (see
        // @speedora/fusion-engine). Pure/synchronous, no try/catch needed
        // here - it never throws for missing signals (see
        // fusionInputSchema's .optional() fields), only for a malformed
        // input shape, which can't happen given the values constructed
        // just above.
        // Speaker Intelligence roadmap, Milestone D - collapses Milestone
        // C's per-speaker/per-moment output into the single clip-level
        // feature set the Fusion Engine consumes (weight 0 until
        // calibrated, see weights.ts). undefined (not passed at all) when
        // speakerScores itself is null, same "optional signal" convention
        // as every other field below.
        const speakerFusionFeatures = speakerScores
          ? deriveSpeakerFusionFeatures(speakerScores)
          : undefined;

        const highlight = computeHighlightScore({
          clipId,
          audio: audioFeatures,
          scene: sceneFeatures,
          // Batch SC-2 - a SEPARATE signal from `scene` above (weight 0
          // until calibrated, see @speedora/fusion-engine's weights.ts).
          sceneMotion: motionEnergyFeatures,
          // Batch SC-3 - also weight 0 until calibrated (see weights.ts).
          cameraMotion: cameraMotionFeatures ?? undefined,
          // Taxonomy category F - also weight 0 until calibrated (see
          // weights.ts).
          editingRhythm: editingRhythmFeatures,
          facial: facialFeatures ?? undefined,
          gesture: gestureFeatures ?? undefined,
          faceGeometry: faceLandmarkFeatures ?? undefined,
          // OCR initiative Batch OCR-2 - the FIRST batch to actually fill
          // the 'ocr' signal's already-reserved 0.1 weight (see
          // weights.ts) since Fase 31.
          ocr: ocrFeatures ?? undefined,
          // Object Intelligence roadmap, Batch OI-1 - also weight 0 until
          // calibrated (see weights.ts).
          object: objectFeatures ?? undefined,
          // Fase 32 - the clip's own Fase 8 Content Intelligence scores,
          // threaded through the job payload (see RenderClipJobData) rather
          // than re-queried here, same "payload carries what the adapter
          // already computed" convention as keywords/transcript above.
          llm: scores ?? undefined,
          speaker: speakerFusionFeatures,
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
            sceneCutEvents: sceneCutEvents ?? Prisma.JsonNull,
            // Batch SC-2 - motionEnergy is a plain JSON array (never
            // JsonNull, see schema.prisma's own comment - always an array,
            // same convention as sceneCuts), so it's cast the same way
            // llmFeatures already is (ClipScores/MotionEnergySample[] are
            // closed types with no index signature, which Prisma's Json
            // input type requires).
            motionEnergy: motionEnergy as unknown as Prisma.InputJsonValue,
            motionEnergyFeatures,
            // Batch SC-3 - cameraMotion CAN be null (Python subprocess,
            // same null-vs-empty-array convention as facialEmotions below),
            // unlike motionEnergy above.
            cameraMotion: cameraMotion ?? Prisma.JsonNull,
            cameraMotionFeatures: cameraMotionFeatures ?? Prisma.JsonNull,
            // Taxonomy category F - always computed (deriveEditingRhythmFeatures
            // never returns null, only all-null fields), same "always
            // populated" convention as sceneFeatures/audioFeatures.
            editingRhythmFeatures,
            facialEmotions: facialEmotions ?? Prisma.JsonNull,
            gestures: gestures ?? Prisma.JsonNull,
            audioFeatures,
            sceneFeatures,
            facialFeatures: facialFeatures ?? Prisma.JsonNull,
            gestureFeatures: gestureFeatures ?? Prisma.JsonNull,
            faceLandmarks: faceLandmarks ?? Prisma.JsonNull,
            faceLandmarkFeatures: faceLandmarkFeatures ?? Prisma.JsonNull,
            trackingQualityMetrics: trackingQualityMetrics ?? Prisma.JsonNull,
            activeSpeakerSamples: activeSpeakerSamples ?? Prisma.JsonNull,
            speakerFaceAssociations: speakerFaceAssociations ?? Prisma.JsonNull,
            lipSyncVerifications: lipSyncVerifications ?? Prisma.JsonNull,
            speakerTimeline: speakerTimeline ?? Prisma.JsonNull,
            speakerTimelineFeatures: speakerTimelineFeatures ?? Prisma.JsonNull,
            speakerConfidenceScores: speakerScores?.confidence ?? Prisma.JsonNull,
            speakerEngagementScores: speakerScores?.engagement ?? Prisma.JsonNull,
            speakerImportanceScores: speakerScores?.importance ?? Prisma.JsonNull,
            speakerHighlightMoments: speakerScores?.highlightMoments ?? Prisma.JsonNull,
            ocrText: ocrText ?? Prisma.JsonNull,
            ocrTracks: ocrTracks ?? Prisma.JsonNull,
            ocrFeatures: ocrFeatures ?? Prisma.JsonNull,
            objects: objects ?? Prisma.JsonNull,
            objectTracks: objectTracks ?? Prisma.JsonNull,
            objectFeatures: objectFeatures ?? Prisma.JsonNull,
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
