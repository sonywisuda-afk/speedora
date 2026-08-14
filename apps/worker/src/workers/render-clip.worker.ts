import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import type {
  CaptionStyleValue,
  ClipScores,
  ConversationDynamics,
  ConversationTypeResult,
  CropDimensions,
  CropWindow,
  EditingSuggestionTimeline,
  FontFamily,
  HookPredictionOutput,
  NarrativeGraph,
  OcrHighlightBox,
  OcrTextTrack,
  PrimarySubjectSample,
  RenderConfigProcessingOptions,
  RetentionCurveInsights,
  SemanticEvent,
  SpeakerTurn,
  SubtitleLine,
  SubtitleSegment,
  ThumbnailWeights,
  TreatmentMoment,
  ViralityPrediction,
} from '@speedora/contracts';
import { rankClipCandidates } from '@speedora/clip-ranking';
import {
  computeFillerCuts,
  computeSilenceCuts,
  mergeCutRanges,
  protectPauseHolds,
  remapTimestamp,
  totalCutSeconds,
  type CutRange,
} from '@speedora/cutlist';
import {
  derivePipelineThreadPresentation,
  NotificationCategory,
  Prisma,
  PublishStatus,
  recordActivityEvent,
  recordNotification,
  recordThreadNotification,
  updateVideoStatus,
  VideoStatus,
  type SocialPlatform as PrismaSocialPlatform,
} from '@speedora/database';
import { computeHighlightScore, rankClips } from '@speedora/fusion-engine';
import {
  migrateProcessingOptions,
  PUBLISH_RETRY_OPTIONS,
  QueueName,
  SocialPlatform,
  type ProcessingOptions,
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
  computeOcrHighlightBoxes,
  findEmphasisWords,
  resolveOutputResolution,
  TARGET_ASPECT_RATIO,
  type FaceSample,
} from '@speedora/reframe';
import {
  buildEffectiveRenderConfig,
  buildOutputProfile,
  buildRenderPlan,
} from '@speedora/render-config';
import { getObjectStream, uploadObject } from '@speedora/storage';
import { isDynamicCaptionEnabled } from '@speedora/dynamic-caption';
import { isSubtitleRewriteEnabled } from '@speedora/subtitle-rewriter';
import {
  isDigitalPushEnabled,
  isFocusShiftEnabled,
  isOcrHighlightEnabled,
  isOcrHighlightWorthy,
  isPauseHoldEnabled,
  isReactionHoldEnabled,
  isSpeakerAwareFocusShiftEnabled,
} from '@speedora/visual-emphasis';
import { buildAss } from '@speedora/subtitles';
import { DEFAULT_THUMBNAIL_WEIGHTS } from '@speedora/thumbnail-selection';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { stockAssetService } from '../assets/stockAssetService';
import {
  BROLL_DURATION_SECONDS,
  BROLL_FADE_SECONDS,
  downloadStockAsset,
  findBRollMoments,
} from '../broll';
import {
  applyReactionHolds,
  concatBrandSegment,
  extractAnimatedPreview,
  extractBlurPlaceholder,
  extractThumbnail,
  fadeOutBRoll,
  getAudioChannelCount,
  getMediaDurationSeconds,
  getVideoDimensions,
  getVideoFrameRateString,
  MAX_OUTPUT_AUDIO_CHANNELS,
  REACTION_HOLD_EXTENSION_SECONDS,
  renderClip,
  trimAndFadeInBRoll,
  trimCutRanges,
  type BRollOverlay,
  type ReframeOptions,
} from '../ffmpeg';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { enqueueNotificationDelivery } from '../notificationDeliveryEnqueuer';
import { publishNotification } from '../notificationPublisher';
import { prisma } from '../prisma';
import { generatePlatformCopyQueue, publishClipQueue } from '../queues';
import { createRedisConnection } from '../redis';
import { compileRenderPlan } from '../render-plan-compiler';
import { cleanupTempFile, reserveScratchPath } from '../storage';

const logger = forStage('render-clip');

// Pre-Processing Settings roadmap (Phase 0/1) - maps the settings screen's
// exportQualityPreset onto real ffmpeg -preset/-crf values. 'balanced'
// intentionally matches reencodeToH264's own preset/crf pair (ffmpeg.ts) for
// consistency across the two places this codebase picks an explicit x264
// quality. null/unset (the common case - a video with no processingOptions,
// or 'balanced' left implicit) resolves to `undefined`, which renderClip()
// treats as "no explicit -preset/-crf" (ffmpeg's own defaults) - not the
// same bytes as passing 'balanced' explicitly, but visually equivalent and
// deliberately left alone rather than silently changing every pre-existing
// render's encode settings.
const EXPORT_QUALITY_PRESETS: Record<string, { preset: string; crf: number }> = {
  maximum_quality: { preset: 'slow', crf: 18 },
  balanced: { preset: 'fast', crf: 23 },
  small_size: { preset: 'veryfast', crf: 28 },
};

function resolveRenderQuality(
  processingOptions: ProcessingOptions | null,
): { preset: string; crf: number } | null {
  const key = processingOptions?.export.qualityPreset;
  return key ? (EXPORT_QUALITY_PRESETS[key] ?? null) : null;
}

// Pre-Processing Settings roadmap (Phase 2) - true (run it) for every field
// when there's no processingOptions at all, matching every pre-Phase-2
// render exactly (same "null means the pipeline's own default" convention
// as resolveRenderQuality above).
function resolveSceneAnalysisFlags(
  processingOptions: ProcessingOptions | null,
): RenderGraphContext['sceneAnalysis'] {
  return {
    detectSceneCuts: processingOptions?.sceneAnalysis.detectSceneCuts ?? true,
    detectMotionEnergy: processingOptions?.sceneAnalysis.detectMotionEnergy ?? true,
    detectCameraMotion: processingOptions?.sceneAnalysis.detectCameraMotion ?? true,
  };
}

// Pre-Processing Settings roadmap (Phase 2) - overrides packages/reframe's
// own MAX_ZOOM_IN_FRACTION constant; undefined (not null) lets
// buildCropPath() fall back to that constant unchanged, same "omit the
// param entirely rather than pass a redundant default" convention as
// renderClip()'s own optional `quality`.
function resolveZoomInFraction(processingOptions: ProcessingOptions | null): number | undefined {
  return processingOptions?.smartCrop.zoomInFraction ?? undefined;
}

// Generic exhaustive-switch guard, same Contract Synchronization purpose as
// assertNeverSocialPlatform below, just not tied to one specific union - used by
// resolveTargetAspectRatio()/resolveResolutionTier() below so a future export.aspectRatio/
// resolutionTier literal added to @speedora/shared's ProcessingOptions fails to compile here
// until a matching case is added, instead of silently falling through.
function assertNever(value: never): never {
  throw new Error(`Unhandled switch case: ${JSON.stringify(value)}`);
}

// Output Resolution/Quality audit, Phase 1 (foundation) - translates the export.aspectRatio
// setting into a raw width/height ratio for @speedora/reframe's computeCropDimensions(), plus the
// concrete label this render actually used (written to Clip.outputAspectRatio below - see that
// column's own schema comment for why it's always one of these five, never 'auto'/null).
// null (every video predating this phase, or one that simply never set it) resolves to
// TARGET_ASPECT_RATIO's own 9/16 - EXACTLY today's hardcoded behavior, byte-for-byte unchanged.
// '4:5'/'4:3' (Phase 4) are explicit-only pins, deliberately excluded from the 'auto' heuristic
// below - see that switch's own comment.
export type ResolvedAspectRatio = {
  ratio: number;
  label: '9:16' | '16:9' | '1:1' | '4:5' | '4:3';
};

// 'auto' orientation heuristic - deliberately simple (source aspect vs. a threshold, not a bare
// "width > height" which would misclassify a near-square source either way depending on which
// side of 1.0 it happened to round to). A Composition Intelligence-informed decision is a real
// future upgrade path (see docs' own "Auto mode" gap), not attempted here.
const AUTO_ASPECT_RATIO_LANDSCAPE_THRESHOLD = 1.2;
const AUTO_ASPECT_RATIO_PORTRAIT_THRESHOLD = 1 / AUTO_ASPECT_RATIO_LANDSCAPE_THRESHOLD;

function resolveTargetAspectRatio(
  processingOptions: ProcessingOptions | null,
  sourceWidth: number,
  sourceHeight: number,
): ResolvedAspectRatio {
  const setting = processingOptions?.export.aspectRatio ?? null;
  switch (setting) {
    case null:
    case '9:16':
      return { ratio: TARGET_ASPECT_RATIO, label: '9:16' };
    case '16:9':
      return { ratio: 16 / 9, label: '16:9' };
    case '1:1':
      return { ratio: 1, label: '1:1' };
    // Output Resolution/Quality audit, Phase 4 - explicit-only pins, same shape as
    // '9:16'/'16:9'/'1:1' above. Deliberately NOT reachable from the 'auto' heuristic below -
    // that heuristic's own 3-way vocabulary (portrait/landscape/square) has no natural "this
    // source wants 4:5" signal, and inventing one wasn't part of this phase's scope.
    case '4:5':
      return { ratio: 4 / 5, label: '4:5' };
    case '4:3':
      return { ratio: 4 / 3, label: '4:3' };
    case 'auto': {
      const sourceAspect = sourceWidth / sourceHeight;
      if (sourceAspect >= AUTO_ASPECT_RATIO_LANDSCAPE_THRESHOLD) {
        return { ratio: 16 / 9, label: '16:9' };
      }
      if (sourceAspect <= AUTO_ASPECT_RATIO_PORTRAIT_THRESHOLD) {
        return { ratio: TARGET_ASPECT_RATIO, label: '9:16' };
      }
      return { ratio: 1, label: '1:1' };
    }
    default:
      return assertNever(setting);
  }
}

// Output Resolution/Quality audit - translates the export.resolutionTier setting into
// @speedora/reframe's resolveOutputResolution() tier vocabulary. null (every video predating
// Phase 1, or one that simply never set it) means NO normalization at all - the pipeline's exact
// pre-Phase-1 behavior (output resolution follows the natural crop, uncapped). 'auto' applies the
// '1080p' tier - real-ffmpeg verification (Phase 2) found the natural crop for the single most
// common conversion (a typical landscape source cropped to 9:16) lands far below any canonical
// delivery size, so resolveOutputResolution() now scales UP to the tier's canonical size when the
// natural crop supports it, subject to its own floor against upscaling too-small source detail
// (see that function's own MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP comment) - 'auto' is a real,
// distinct choice from null, not a synonym for "no normalization".
function resolveResolutionTier(
  processingOptions: ProcessingOptions | null,
): '1080p' | '720p' | null {
  const setting = processingOptions?.export.resolutionTier ?? null;
  switch (setting) {
    case null:
      return null;
    case 'auto':
      return '1080p';
    case '1080p':
    case '720p':
      return setting;
    default:
      return assertNever(setting);
  }
}

// AI B-roll Recommendation UI control - `enabled` true (run it) with no
// processingOptions at all, matching every pre-existing render exactly
// (same "null means the pipeline's own default" convention as every other
// resolveXxx above). `maxMoments` mirrors resolveZoomInFraction's
// undefined-not-null convention so findBRollMoments()'s own default
// parameter (broll.ts's exported MAX_BROLL_MOMENTS) applies unchanged when
// nothing was configured, rather than this function duplicating that
// constant.
function resolveBRollOptions(processingOptions: ProcessingOptions | null): {
  enabled: boolean;
  maxMoments: number | undefined;
} {
  return {
    enabled: processingOptions?.broll.enabled ?? true,
    maxMoments: processingOptions?.broll.maxCutaways ?? undefined,
  };
}

// Render Fidelity & Composition Execution Engine, Phase 1 (EffectiveRenderConfig) - see
// packages/contracts/src/render-config.ts's own module comment for the full scope-boundary
// reasoning and docs/ai/render-fidelity-matrix.md for the Phase 0 audit this is built on top of.
// Narrows the real (post-migrateProcessingOptions()) ProcessingOptions down to
// @speedora/render-config's own deliberately smaller input contract - same "narrow the input to
// only what the module needs" adapter responsibility toScoringInput()/shortlistRawCandidates()
// already have in detect-clips.worker.ts. `null` passes straight through, matching every existing
// resolveX() helper's own "no processingOptions at all -> every default applies" convention.
function toRenderConfigProcessingOptions(
  processingOptions: ProcessingOptions | null,
): RenderConfigProcessingOptions | null {
  if (!processingOptions) return null;
  return {
    export: {
      qualityPreset: processingOptions.export.qualityPreset,
      aspectRatio: processingOptions.export.aspectRatio,
      resolutionTier: processingOptions.export.resolutionTier,
    },
    smartCrop: { zoomInFraction: processingOptions.smartCrop.zoomInFraction },
    broll: {
      enabled: processingOptions.broll.enabled,
      maxCutaways: processingOptions.broll.maxCutaways,
    },
    sceneAnalysis: {
      detectSceneCuts: processingOptions.sceneAnalysis.detectSceneCuts,
      detectMotionEnergy: processingOptions.sceneAnalysis.detectMotionEnergy,
      detectCameraMotion: processingOptions.sceneAnalysis.detectCameraMotion,
    },
  };
}

// Pre-Processing Settings roadmap (Phase 3) - boosts (not replaces) each
// preferred signal's own DEFAULT_THUMBNAIL_WEIGHTS entry, so a preference
// shifts which instant wins without zeroing out every other signal's real
// contribution. undefined (no preference set - the common case) means
// thumbnailSelectionNode passes no override at all, identical to every
// pre-Phase-3 render (see that node's own comment). An unrecognized signal
// name can't reach this function at all - the DTO layer already rejects it
// (@IsIn(THUMBNAIL_SIGNALS)) - but ?? 0 below is still the honest fallback
// if one ever did, rather than throwing.
const THUMBNAIL_PREFERENCE_BOOST = 2;

function resolveThumbnailWeights(
  processingOptions: ProcessingOptions | null,
): ThumbnailWeights | undefined {
  const preferred = processingOptions?.thumbnail.preferredSignals;
  if (!preferred || preferred.length === 0) return undefined;
  const weights: ThumbnailWeights = { ...DEFAULT_THUMBNAIL_WEIGHTS };
  for (const signal of preferred) {
    weights[signal] = (DEFAULT_THUMBNAIL_WEIGHTS[signal] ?? 0) * THUMBNAIL_PREFERENCE_BOOST;
  }
  return weights;
}

// Pre-Processing Settings roadmap (Phase 3) - same rate-limit window/cap as
// ClipsService.generatePlatformCopy() (apps/api), duplicated here rather
// than shared - same "each render-enqueue site inlines its own resolution"
// convention DEFAULT_WATERMARK_* etc. already use. In practice this cap is
// never hit by the automatic trigger itself (a fresh clip has zero prior
// ClipPlatformCopy rows for a platform); it only matters if this same clip
// is later re-rendered (VideosService.retry()) with the same platform still
// selected.
const PLATFORM_COPY_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PLATFORM_COPY_GENERATIONS_PER_DAY = 5;

// Pre-Processing Settings roadmap (Phase 3) - the automatic equivalent of
// apps/api's POST /clips/:id/platform-copy (ClipsService.generatePlatformCopy()),
// triggered right after a clip finishes rendering instead of requiring a
// manual click per platform afterward. Same guards as the manual endpoint -
// a clip with no hookText yet has nothing to build SEO copy from; the same
// 24h/5-per-platform rate cap - and the same "create the row synchronously,
// then enqueue" shape. Never fails the render job itself: best-effort, same
// "optional signal" posture as ranking/cover-thumbnail-promotion below.
function assertNeverSocialPlatform(value: never): never {
  throw new Error(`Unhandled SocialPlatform: ${JSON.stringify(value)}`);
}

// packages/shared's SocialPlatform and Prisma's are nominally distinct TS
// enum types even though they share the same runtime string values (same
// "Mirrors X" convention used throughout this project). The switch has no
// `default` case, so a new packages/shared member fails to compile here
// until a matching case is added - same Contract Synchronization pattern as
// apps/api's dashboard.service.ts (mapActivityEventType), replacing what
// used to be a blind `as unknown as` cast. Duplicated from apps/api's own
// mapSharedSocialPlatformToPrisma (social/publish-record.util.ts) rather
// than imported - apps/worker has no HTTP server and never imports from
// apps/api, same app-boundary convention as every other cross-app pairing
// in this codebase.
export function mapSharedSocialPlatformToPrisma(platform: SocialPlatform): PrismaSocialPlatform {
  switch (platform) {
    case SocialPlatform.YOUTUBE:
      return 'YOUTUBE';
    case SocialPlatform.TIKTOK:
      return 'TIKTOK';
    case SocialPlatform.INSTAGRAM:
      return 'INSTAGRAM';
    case SocialPlatform.FACEBOOK:
      return 'FACEBOOK';
    case SocialPlatform.THREADS:
      return 'THREADS';
    case SocialPlatform.LINKEDIN:
      return 'LINKEDIN';
    case SocialPlatform.PINTEREST:
      return 'PINTEREST';
    case SocialPlatform.X:
      return 'X';
    default:
      return assertNeverSocialPlatform(platform);
  }
}

async function triggerAutoPlatformCopy(
  clipId: string,
  hookText: string | null,
  processingOptions: ProcessingOptions | null,
): Promise<void> {
  if (!processingOptions?.seo.autoGeneratePlatformCopy || !hookText) return;

  for (const platform of processingOptions.seo.platforms) {
    try {
      const prismaPlatform = mapSharedSocialPlatformToPrisma(platform);
      const since = new Date(Date.now() - PLATFORM_COPY_RATE_LIMIT_WINDOW_MS);
      const recentCount = await prisma.clipPlatformCopy.count({
        where: {
          clipId,
          platform: prismaPlatform,
          createdAt: { gte: since },
        },
      });
      if (recentCount >= MAX_PLATFORM_COPY_GENERATIONS_PER_DAY) {
        logger.info('skipping auto platform-copy generation - rate limit already reached', {
          clipId,
          platform,
        });
        continue;
      }

      const row = await prisma.clipPlatformCopy.create({
        data: { clipId, platform: prismaPlatform },
      });
      await generatePlatformCopyQueue.add(QueueName.GENERATE_PLATFORM_COPY, {
        clipPlatformCopyId: row.id,
      });
    } catch (error) {
      logger.warn(
        'auto platform-copy generation failed, continuing without it',
        { clipId, platform },
        error,
      );
    }
  }
}

// Pre-Processing Settings roadmap (Phase 3) - the automatic equivalent of
// apps/api's POST /clips/:id/publish (ClipsService.publish()), triggered
// right after a clip finishes rendering. A pure orchestrator: creates the
// exact same PublishRecord shape that endpoint creates and either enqueues
// it on the SAME PUBLISH_CLIP queue with the SAME PUBLISH_RETRY_OPTIONS
// (immediate) or leaves it SCHEDULED for the ALREADY-RUNNING
// schedule-publish-clip poller to pick up (future scheduledAt) - no new
// retry, scheduling, or platform-API logic lives here. A scheduledAt that's
// already in the past by the time a render finishes (a real possibility for
// a long/queued video) publishes immediately instead of silently dropping
// it. `ownerId` gates `socialAccountIds` the same way `findOwnedOrThrow`
// does for the manual endpoint - a foreign/deleted account id is skipped
// with a logged warning, never fails the render.
async function triggerAutoPublish(
  clipId: string,
  ownerId: string,
  processingOptions: ProcessingOptions | null,
): Promise<void> {
  if (!processingOptions?.publishing.autoPublish) return;

  for (const socialAccountId of processingOptions.publishing.socialAccountIds) {
    try {
      const socialAccount = await prisma.socialAccount.findUnique({
        where: { id: socialAccountId },
      });
      if (!socialAccount || socialAccount.userId !== ownerId) {
        logger.warn(
          'processingOptions named a social account that no longer exists or is not owned ' +
            'by this video - skipping auto-publish for it',
          { clipId, socialAccountId },
        );
        continue;
      }

      const requestedAt = processingOptions.publishing.scheduledAt
        ? new Date(processingOptions.publishing.scheduledAt)
        : null;
      const scheduledAt = requestedAt && requestedAt.getTime() > Date.now() ? requestedAt : null;

      const record = await prisma.publishRecord.create({
        data: {
          clipId,
          socialAccountId,
          status: scheduledAt ? PublishStatus.SCHEDULED : PublishStatus.QUEUED,
          scheduledAt,
        },
      });

      if (!scheduledAt) {
        await publishClipQueue.add(
          QueueName.PUBLISH_CLIP,
          { publishRecordId: record.id },
          PUBLISH_RETRY_OPTIONS,
        );
      }
    } catch (error) {
      logger.warn('auto-publish failed, continuing without it', { clipId, socialAccountId }, error);
    }
  }
}

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

// Narrows a DB-shaped TranscriptSegment down to @speedora/subtitles' own,
// smaller input contract - same pattern as detect-clips.worker.ts's
// toScoringInput() for @speedora/clip-scoring. `speaker` is passed through
// (Subtitle Studio roadmap, P2c - only read when speakerColorCaptions is
// true). `text` prefers the requested language's translation when one
// exists (P2f) - a segment with no translation for that language still
// falls back to its original text, never dropped/blanked. `words` is
// deliberately still the ORIGINAL-language word timings even when
// translated (a translated caption can't reuse the original's per-word
// timestamps - karaoke-style word-by-word highlighting for a translated
// segment is a known, accepted gap, not attempted here).
//
// AI Intelligence v4 Track B, Phase A2 (Subtitle Rewriter render wiring -
// see docs/ai/subtitle-intelligence.md) - `subtitleTimeline` is
// Clip.subtitleIntelligence's already-rewritten SubtitleLine[] (this same
// render's own render-graph output), passed only when the caller has
// already decided smart segmentation applies (see the call site's own
// gating comment). Every SubtitleLine field maps 1:1 onto SubtitleSegment
// (start/end/text/words/speaker) - buildAss() itself needs ZERO changes,
// since a rewritten line's BOLD_HIGHLIGHT emphasis is naturally reproduced
// by its own live KEYWORD_PATTERN regex over the identical, unmodified
// words (Tech Debt #2's original "widen buildAssInputSchema" plan turned
// out to be unnecessary once this was worked through). `emphasisWordIndices`
// is intentionally dropped here - it has no buildAss() consumer yet.
//
// COORDINATE FRAME: subtitleTimeline is CLIP-relative (0 = this clip's own
// start - see render-graph/nodes/subtitle-rewriter.ts's own
// toSubtitleRewriterSegments, which shifts by -startTime before computing
// it), but buildAss() always expects ABSOLUTE source-video time in
// `segments` and does its own `- clipStart` shift internally (same as the
// raw-transcript branch below, whose `segment.start` is absolute). `+
// startTime` here re-expresses the timeline back into that same absolute
// frame - a real bug caught while writing this phase's own tests, not a
// change to any word's actual moment in time (ADR DB1's "unchanged"
// guarantee is about word identity/order/duration, not which coordinate
// frame a timestamp happens to be written in).
//
// AI Intelligence v4 Track B, Phase B2 (Dynamic Caption Engine render
// wiring - see docs/ai/subtitle-intelligence.md) - `captionTreatment` is
// Clip.captionTreatment's already-decided TreatmentMoment[] (this same
// render's own render-graph output, ALSO clip-relative - see
// render-graph/nodes/dynamic-caption.ts), passed only when the caller has
// already decided dynamic captions apply. Zipped onto each SubtitleLine by
// ARRAY INDEX, not by a timestamp re-match: @speedora/dynamic-caption's
// computeCaptionTreatment() builds its own output via `timeline.map(...)`
// over this exact same subtitleTimeline array, so the two are guaranteed
// the same length/order by construction - no separate coordinate-frame
// conversion is needed for the treatment fields themselves (sizeTier/
// animation carry no timestamps of their own).
function toSubtitleSegments(
  transcript: RenderClipJobData['transcript'],
  captionLanguage: string | null,
  subtitleTimeline: SubtitleLine[] | null,
  startTime: number,
  captionTreatment: TreatmentMoment[] | null,
): SubtitleSegment[] {
  if (subtitleTimeline) {
    return subtitleTimeline.map((line, index) => ({
      start: line.start + startTime,
      end: line.end + startTime,
      text: line.text,
      words: line.words.map((word) => ({
        word: word.word,
        start: word.start + startTime,
        end: word.end + startTime,
      })),
      speaker: line.speaker,
      sizeTier: captionTreatment?.[index]?.sizeTier,
      animation: captionTreatment?.[index]?.animation,
    }));
  }
  return transcript.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: (captionLanguage && segment.translations?.[captionLanguage]) || segment.text,
    words: segment.words,
    speaker: segment.speaker,
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
//
// Visual Emphasis Engine Phase C7 ("Pause Hold", docs/ai/visual-emphasis-
// engine.md) - editingSuggestions is Phase C1's own, ALWAYS computed
// regardless of any Visual Emphasis Engine flag. Filtered to
// technique === 'pause_hold' and gated by isPauseHoldEnabled() right
// here, same "each technique checks its own flag inside the function
// that consumes it" shape C3/C4/C5 already established. protectPauseHolds()
// runs BEFORE mergeCutRanges() combines silence cuts with filler-word
// cuts, deliberately - see that function's own comment for why a merged
// range would break the exact-match protection check.
function computeClipCuts(
  transcript: RenderClipJobData['transcript'],
  startTime: number,
  endTime: number,
  editingSuggestions: EditingSuggestionTimeline = [],
): CutRange[] {
  const words = toClipRelativeWords(transcript, startTime);
  const silenceCuts = computeSilenceCuts(words, endTime - startTime);
  const protectedWindows = isPauseHoldEnabled()
    ? editingSuggestions
        .filter((suggestion) => suggestion.technique === 'pause_hold')
        .map((suggestion) => ({ start: suggestion.start, end: suggestion.end }))
    : [];

  return mergeCutRanges([
    ...protectPauseHolds(silenceCuts, protectedWindows),
    ...computeFillerCuts(words),
  ]);
}

// Visual Emphasis Engine Phase C6R.3 ("Reaction Hold Temporal Extension" -
// see docs/ai/visual-emphasis-engine.md's "C6R design" section) -
// editingSuggestions is Phase C1's own, ALWAYS computed regardless of any
// Visual Emphasis Engine flag; filtered to technique === 'reaction_hold'
// here. Gating on isReactionHoldEnabled() happens at THIS function's own
// call site below, same "each technique checks its own flag where it's
// consumed" shape C3/C4/C5/C7 already established - this function itself
// stays a pure, flag-agnostic computation, easy to unit test in isolation.
//
// Three steps, per the C6R design's own "Still open" resolutions:
// 1. Merge overlapping/adjacent SUGGESTION windows first (reusing
//    mergeCutRanges()'s own sort-and-merge shape, not inventing a second
//    one) - two emotional peaks close enough that their reaction_hold
//    windows overlap read as ONE reaction moment, not two separate
//    freezes.
// 2. Each merged window's own MIDPOINT becomes the freeze instant - the
//    same "peak-centered" convention fromEmotionalPeaks() already
//    established when it built each window as `peak.t ± window/2` in the
//    first place (the midpoint of an un-merged window exactly recovers
//    that original peak.t).
// 3. Remap each instant from the ORIGINAL clip-relative timeline (where
//    Phase C1 suggestions live) onto the POST-CUT timeline via
//    @speedora/cutlist's remapTimestamp() (C6R.1), against THIS SAME
//    clip's own already-computed `cuts` (whatever computeClipCuts() just
//    decided to cut, including any Phase C7 pause-hold protection) -
//    `null` (the instant itself was cut away entirely) means skip that
//    hold, same "protect/apply rarely, don't guess" conservatism
//    protectPauseHolds() already established, never fabricate a nearby
//    position.
//
// A final minimum-separation pass drops any surviving instant landing
// within `holdDurationSeconds` of the previous one - cuts can only ever
// SHRINK the gap between two original instants, never grow it, so two
// suggestions comfortably separated pre-cut could still end up too close
// together post-cut for applyReactionHolds()'s own per-hold segment math
// to stay well-formed. Conservative by design (drops the later instant
// rather than trying to reconcile two freezes into one) - the merged/
// remapped list is already sorted ascending (mergeCutRanges sorts, and
// remapTimestamp is order-preserving for non-overlapping cuts), so a
// single forward pass is enough.
function computeReactionHoldInstants(
  editingSuggestions: EditingSuggestionTimeline,
  cuts: CutRange[],
  holdDurationSeconds: number,
): number[] {
  const windows = editingSuggestions
    .filter((suggestion) => suggestion.technique === 'reaction_hold')
    .map((suggestion) => ({ start: suggestion.start, end: suggestion.end }));

  const remapped = mergeCutRanges(windows)
    .map((window) => remapTimestamp((window.start + window.end) / 2, cuts))
    .filter((t): t is number => t !== null);

  const instants: number[] = [];
  for (const t of remapped) {
    if (instants.length === 0 || t - instants[instants.length - 1] >= holdDurationSeconds) {
      instants.push(t);
    }
  }
  return instants;
}

// Visual Emphasis Engine Phase C2 (docs/ai/visual-emphasis-engine.md, ADR
// DC3/Tech Debt #1) - the clip's constant output frame dimensions,
// genuinely independent of face/subject detection (computeCropDimensions()
// only looks at the SOURCE video's own width/height). Split out of the old
// (pre-C2) buildReframePlan() so it can run BEFORE the render graph -
// compositionFeaturesNode needs ctx.reframe.outputWidth/outputHeight for
// its own aspect-ratio-aware thresholds, and the graph must exist before
// buildReframePlan() below can consume its primarySubjectSamples output.
//
// Output Resolution/Quality audit - now also resolves the target aspect ratio
// (resolveTargetAspectRatio(), defaulting to the fixed 9/16 every clip has always used) and
// normalizes the crop to a resolution tier's canonical size (resolveOutputResolution() - Phase 1
// shipped this as a cap only; Phase 2 found real-ffmpeg verification requires scaling UP too for
// the common case, see that function's own comment - defaulting to no normalization at all,
// today's exact behavior, unless a tier is actually set).
//
// `crop` and `outputSize` are DELIBERATELY two separate values now, not one - a real Phase 2
// wiring bug (caught by ffmpeg.output-profile.integration.spec.ts crashing ffmpeg outright, not
// just an assertion failure) is exactly what happens if they get collapsed back into one: `crop`
// is the NATURAL crop region, always bounded by the source's own pixel dimensions (what
// buildCropPath()'s pan/zoom math and computeOcrHighlightBoxes() must stay within, and what the
// ffmpeg `crop=` filter's own w/h/x/y literally are) - it can never exceed sourceWidth/
// sourceHeight. `outputSize` is the FINAL delivered resolution after normalization, which CAN be
// bigger than `crop` when resolveOutputResolution() scales up - feeding that into ffmpeg's `crop=`
// filter directly (instead of just `scale=` after it) asks ffmpeg to crop a region larger than the
// source frame, which fails outright ("Invalid too big ... size"), not just look wrong. Every
// consumer of the FINAL coordinate system (captions, B-roll, watermark, OCR highlight,
// compositionFeaturesNode) must read `outputSize`/`reframe.outputWidth`/`outputHeight`, never
// `crop`, for exactly this reason.
async function computeReframeDimensions(
  sourcePath: string,
  processingOptions: ProcessingOptions | null,
): Promise<{
  crop: CropDimensions;
  outputSize: CropDimensions;
  sourceWidth: number;
  sourceHeight: number;
  aspectRatioLabel: ResolvedAspectRatio['label'];
  // Output Resolution/Quality audit, Phase 5 (FPS/CFR policy) - see getVideoFrameRateString()'s
  // and trimCutRanges()'s own comments for what this is used for. Probed here (alongside the
  // existing width/height probe, same sourcePath, same "before the render graph" timing) rather
  // than inside trimCutRanges() itself - crop/scale never touch frame timing, so the source's own
  // rate is identical to renderClip()'s output rate, and probing it once here avoids a second,
  // redundant ffprobe subprocess call later.
  sourceFrameRate: string | null;
  // Output Resolution/Quality audit, Phase 6 (Audio params finalization) - the source's real
  // audio channel count, ALREADY CLAMPED to MAX_OUTPUT_AUDIO_CHANNELS - see
  // resolveAudioEncodeArgs()'s and trimCutRanges()'s own `sourceAudioChannels` comments for why
  // clamping happens once, here, rather than inside each ffmpeg.ts function. renderClip() gets
  // the pre-clamp raw count instead (see the call site below) since it's the one function that
  // actually needs to know whether a real downmix is required, not just the final channel count.
  clampedAudioChannels: number | null;
  sourceAudioChannels: number | null;
}> {
  const [{ width: sourceWidth, height: sourceHeight }, sourceFrameRate, sourceAudioChannels] =
    await Promise.all([
      getVideoDimensions(sourcePath),
      getVideoFrameRateString(sourcePath),
      getAudioChannelCount(sourcePath),
    ]);
  const { ratio, label } = resolveTargetAspectRatio(processingOptions, sourceWidth, sourceHeight);
  const crop = computeCropDimensions(sourceWidth, sourceHeight, ratio);
  const outputSize = resolveOutputResolution(crop, ratio, resolveResolutionTier(processingOptions));
  const clampedAudioChannels =
    sourceAudioChannels !== null ? Math.min(sourceAudioChannels, MAX_OUTPUT_AUDIO_CHANNELS) : null;
  return {
    crop,
    outputSize,
    sourceWidth,
    sourceHeight,
    aspectRatioLabel: label,
    sourceFrameRate,
    clampedAudioChannels,
    sourceAudioChannels,
  };
}

// Composition Intelligence's PrimarySubjectSample already shares
// buildCropPath()'s FaceSample box shape byte-for-byte ({xCenter, yCenter,
// width, height} | null) - ADR DC3's own finding, confirmed by reading
// both contracts. No conversion beyond dropping the extra fields
// (trackId/facingYaw/source) buildCropPath() has no use for.
function toFaceSamples(samples: PrimarySubjectSample[]): FaceSample[] {
  return samples.map((sample) => ({ t: sample.t, box: sample.box }));
}

// Builds the crop/zoom plan for a clip from the render graph's own
// primarySubjectSamples (Composition Intelligence's already-built
// selectPrimarySubject() chain: active speaker -> face -> tracked person ->
// highest objectAttentionScore -> tracked object). Visual Emphasis Engine
// Phase C2 (docs/ai/visual-emphasis-engine.md, ADR DC3/Tech Debt #1) -
// UNIFIES what used to be two independent, disagreeing opinions about "who
// is the subject": this function previously called packages/reframe's own
// standalone detectFaces() (a SEPARATE MediaPipe Face Detector subprocess
// from the one render-graph/nodes/face-speaker.ts's faceLandmarksNode
// already runs via MediaPipe FaceLandmarker), producing a face-only,
// object-blind answer that never saw Composition Intelligence's richer
// selection. Now there is exactly one "who is the subject" answer for the
// whole pipeline - this function only converts already-computed samples
// into buildCropPath()'s existing input shape, it detects nothing new
// itself (Tech Debt #2, "buildCropPath() has no object-track input", is
// fixed as a free byproduct: PrimarySubjectSample can carry
// object-sourced entries too, so a faceless clip with a tracked object now
// pans toward it instead of staying static). Deliberately no try/catch
// (unlike the old detectFaces() call, an external Python subprocess that
// could genuinely fail): primarySubjectSamples always resolves to a real
// (possibly empty) array once the render graph completes
// (primarySubjectSamplesNode is optional: false and handles every
// upstream null itself), so a thrown error here would be a real code bug,
// not an expected I/O failure to swallow.
async function buildReframePlan(
  primarySubjectSamples: PrimarySubjectSample[],
  transcript: RenderClipJobData['transcript'],
  startTime: number,
  crop: CropDimensions,
  // Output Resolution/Quality audit, Phase 2 - the FINAL delivered resolution, separate from
  // `crop` on purpose (see computeReframeDimensions()'s own comment for the real bug this
  // separation fixes: `crop` is source-bounded and feeds the ffmpeg `crop=` filter's literal
  // w/h/x/y; `outputSize` can be bigger when resolveOutputResolution() scaled up, and feeds ONLY
  // outputWidth/outputHeight below, which ffmpeg.ts's renderClip() turns into a `scale=` filter
  // AFTER the crop).
  outputSize: CropDimensions,
  sourceWidth: number,
  sourceHeight: number,
  clipDurationSeconds: number,
  // Pre-Processing Settings roadmap (Phase 2) - undefined lets
  // buildCropPath() fall back to its own MAX_ZOOM_IN_FRACTION default.
  zoomInFraction?: number,
  // Visual Emphasis Engine Phase C1's own editingSuggestions - ALWAYS
  // computed regardless of VISUAL_EMPHASIS_ENABLED (that flag gates only
  // GET /clips/:id/intelligence's exposure). Passed through unfiltered;
  // each technique below (Phase C3's focus_shift, Phase C4's digital_push,
  // ...) is filtered out and gated by its OWN flag right here, not at the
  // call site - a deliberate C4 refactor of C3's original shape, needed
  // now that two independently-toggleable techniques both read from this
  // same array (docs/ai/visual-emphasis-engine.md's "C4 rollout" note:
  // "don't make one master flag for all rendering" - each technique's own
  // flag decides its own inclusion, checked in exactly one place). Empty
  // by default so every pre-C3 caller/test keeps buildCropPath()'s exact
  // prior drift/zoom behavior.
  editingSuggestions: EditingSuggestionTimeline = [],
  // Visual Emphasis Engine Phase C5 ("OCR Highlight", docs/ai/
  // visual-emphasis-engine.md) - graphResult.ocrTracks itself, always
  // computed regardless of any flag (OCR-2's own render-graph node).
  // Filtered by isOcrHighlightWorthy() (the SAME filter Phase C1's
  // fromOcrTracks() already uses for the ocr_highlight suggestion
  // timeline - one filter definition, not two) and gated by
  // isOcrHighlightEnabled() right here, same "each technique checks its
  // own flag inside this function" shape C3/C4 already established.
  ocrTracks: OcrTextTrack[] | null = null,
): Promise<{
  reframe: ReframeOptions;
  ocrHighlights: OcrHighlightBox[];
  // Render Fidelity & Composition Execution Engine, Phase 3 (RenderPlan) - the already-computed
  // cropPath was previously discarded here once its own sendCmd script was written to disk (the
  // only thing renderClip() itself needs). Widened to ALSO return it so RenderPlan.framing can
  // preserve this real, already-made render decision instead of losing it - no change to the
  // crop/reframe algorithm itself, and every existing caller ignoring this new field sees no
  // behavior change. null means a static (non-time-varying) center crop was used for the whole
  // clip, same meaning buildCropPath()'s own null return already has.
  cropPath: CropWindow[] | null;
}> {
  const emphasisWords = findEmphasisWords(toClipRelativeWords(transcript, startTime));
  // Visual Emphasis Engine Phase C3 ("Focus Shift") - @speedora/reframe
  // stays decoupled from @speedora/visual-emphasis's own EditingSuggestion
  // vocabulary; the filter/map to buildCropPath()'s plain {start, end}
  // shape happens right here, at this orchestration seam.
  const visualFocusShifts = isFocusShiftEnabled()
    ? editingSuggestions
        .filter((suggestion) => suggestion.technique === 'focus_shift')
        .map((suggestion) => ({ start: suggestion.start, end: suggestion.end }))
    : [];
  // Speaker Intelligence Phase E ("speaker_focus_shift", see docs/ai/
  // speaker-intelligence.md) - a SEPARATE source feeding the exact same
  // buildCropPath() window list below, gated by its own independent flag
  // (isSpeakerAwareFocusShiftEnabled(), not isFocusShiftEnabled() above) so
  // it can be toggled off on its own without disabling the older,
  // visual-track-based source. Concatenated, not replacing - both sources
  // can contribute in the same render.
  const speakerFocusShifts = isSpeakerAwareFocusShiftEnabled()
    ? editingSuggestions
        .filter((suggestion) => suggestion.technique === 'speaker_focus_shift')
        .map((suggestion) => ({ start: suggestion.start, end: suggestion.end }))
    : [];
  const focusShifts = [...visualFocusShifts, ...speakerFocusShifts];
  // Visual Emphasis Engine Phase C4 ("Digital Push", docs/ai/
  // visual-emphasis-engine.md) - extends Auto Zoom's (Fase 11) existing
  // emphasis-word trigger set with Phase C1's own digital_push suggestions
  // (Phase A1/B1's HighlightTimeline, already thresholded upstream by
  // computeHighlightTimeline()'s own PUNCH_THRESHOLD before ever becoming
  // a suggestion). Only `start` is used - buildCropPath()'s existing
  // zoomEnvelopeAt() attack/hold/release envelope shape is reused
  // UNCHANGED, exactly like an emphasis word's own trigger (ADR-equivalent
  // decision recorded in the design doc's "C4 architecture" section) - no
  // second zoom mechanism, only a second trigger source feeding the same
  // one.
  const digitalPushStarts = isDigitalPushEnabled()
    ? editingSuggestions
        .filter((suggestion) => suggestion.technique === 'digital_push')
        .map((suggestion) => suggestion.start)
    : [];
  const cropPath = buildCropPath(
    toFaceSamples(primarySubjectSamples),
    emphasisWords,
    crop,
    sourceWidth,
    sourceHeight,
    clipDurationSeconds,
    zoomInFraction,
    focusShifts,
    digitalPushStarts,
  );

  // Visual Emphasis Engine Phase C5 - qualifying tracks (same
  // isOcrHighlightWorthy() filter Phase C1's own suggestion timeline
  // uses), computed regardless of which crop-path branch below runs.
  // computeOcrHighlightBoxes() needs a real (non-empty) crop WINDOW to
  // anchor a position to - buildCropPath() returning null means a
  // STATIC center-crop was used for the whole clip, still a real,
  // constant crop window for this function's purposes (a single-element
  // synthetic path spanning the whole clip), not "no crop at all".
  const ocrHighlightTracks = isOcrHighlightEnabled()
    ? (ocrTracks ?? []).filter(isOcrHighlightWorthy)
    : [];

  if (!cropPath) {
    const staticReframe: ReframeOptions = {
      outputWidth: outputSize.width,
      outputHeight: outputSize.height,
      width: crop.width,
      height: crop.height,
      x: Math.round((sourceWidth - crop.width) / 2),
      y: Math.round((sourceHeight - crop.height) / 2),
      sendCmdPath: null,
    };
    const ocrHighlights = computeOcrHighlightBoxes(
      ocrHighlightTracks,
      [
        {
          t: 0,
          x: staticReframe.x,
          y: staticReframe.y,
          width: staticReframe.width,
          height: staticReframe.height,
        },
      ],
      sourceWidth,
      sourceHeight,
      staticReframe.outputWidth,
      staticReframe.outputHeight,
    );
    return { reframe: staticReframe, ocrHighlights, cropPath: null };
  }

  const sendCmdPath = await reserveScratchPath('reframe-cmds', '.txt');
  await writeFile(sendCmdPath, buildSendCmdScript(cropPath, 'crop@reframe'));
  const reframe: ReframeOptions = {
    outputWidth: outputSize.width,
    outputHeight: outputSize.height,
    width: cropPath[0].width,
    height: cropPath[0].height,
    x: cropPath[0].x,
    y: cropPath[0].y,
    sendCmdPath,
  };
  const ocrHighlights = computeOcrHighlightBoxes(
    ocrHighlightTracks,
    cropPath,
    sourceWidth,
    sourceHeight,
    reframe.outputWidth,
    reframe.outputHeight,
  );
  return { reframe, ocrHighlights, cropPath };
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
  maxMoments: number | undefined,
  namedEntities: string[],
  // Render Fidelity Matrix bug fix #2 (docs/ai/render-fidelity-matrix.md) - the same
  // already-probed sourceFrameRate computeReframeDimensions() returns, threaded through to
  // trimAndFadeInBRoll() below instead of letting it fall back to a hardcoded 30fps regardless
  // of what rate the rest of this clip actually renders at.
  outputFrameRate: string | null,
): Promise<{
  // Render Fidelity & Composition Execution Engine, Phase 3 (RenderPlan) - each overlay is
  // widened with the `keyword` that drove its own search, preserved alongside the fields
  // renderClip() already reads (filePath/startTime/endTime, unchanged) - structurally still a
  // valid BRollOverlay[] wherever that's expected (extra field, no removal), so this is a
  // backward-compatible widening, not a shape change for any existing consumer. Lets
  // RenderPlan.overlays.broll capture the real decision (which keyword produced which moment)
  // instead of only the ephemeral render-time file path, which buildRenderPlan() deliberately
  // never sees (see that module's own comment on why - determinism).
  overlays: (BRollOverlay & { keyword: string })[];
  finalPaths: string[];
}> {
  const moments = findBRollMoments(
    keywords,
    clipRelativeWords,
    clipDurationSeconds,
    maxMoments,
    namedEntities,
  );

  // Reliability/performance hardening pass - each moment's search/download/
  // fade-in/fade-out is independent of every other moment (its own
  // uniquely-named scratch files via reserveScratchPath's randomUUID, no
  // shared mutable state), so this runs them concurrently instead of the
  // previous fully-serial for...of - real wall-clock savings for a clip
  // with multiple B-roll moments, all of which previously ran before the
  // main render pass even started. Still bounded by subprocessLimiter.ts's
  // process-wide semaphore for the ffmpeg calls inside
  // (trimAndFadeInBRoll/fadeOutBRoll), so this doesn't reopen the
  // contention risk that justified concurrency: 1 elsewhere on this
  // worker's own BullMQ queue - it only removes an artificial *extra* layer
  // of serialization stacked on top of that shared budget. Promise.all
  // preserves moments' original order in its results regardless of
  // completion timing, so the returned arrays stay in the same order a
  // fully-serial loop would have produced.
  const results = await Promise.all(
    moments.map(async (moment) => {
      let rawPath: string | null = null;
      let fadedInPath: string | null = null;
      try {
        const asset = await stockAssetService.searchAssets(moment.keyword, moment.isBrandCandidate);
        if (!asset) return null;

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
          outputFrameRate,
        );

        const finalPath = await reserveScratchPath('broll-final', '.mov');
        await fadeOutBRoll(fadedInPath, finalPath, BROLL_DURATION_SECONDS, BROLL_FADE_SECONDS);

        return {
          overlay: {
            filePath: finalPath,
            startTime: moment.t,
            endTime: moment.t + BROLL_DURATION_SECONDS,
            keyword: moment.keyword,
          },
          finalPath,
        };
      } catch (error) {
        logger.warn('B-roll moment failed, skipping it', { keyword: moment.keyword }, error);
        return null;
      } finally {
        if (rawPath) await cleanupTempFile(rawPath);
        if (fadedInPath) await cleanupTempFile(fadedInPath);
      }
    }),
  );

  const overlays: (BRollOverlay & { keyword: string })[] = [];
  const finalPaths: string[] = [];
  for (const result of results) {
    if (!result) continue;
    overlays.push(result.overlay);
    finalPaths.push(result.finalPath);
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

// Render Fidelity Matrix bug fix #5 (docs/ai/render-fidelity-matrix.md) - matches the tolerance
// already independently verified/pinned against real ffmpeg output rounding in
// ffmpeg.duration.integration.spec.ts, rather than inventing a new number.
const DURATION_VERIFICATION_TOLERANCE_SECONDS = 1.5;

// A brand segment's own contribution to the final duration - mirrors concatBrandSegment()'s own
// duration resolution (getMediaDurationSeconds() for a video, imageDurationSeconds for a still)
// closely enough for a tolerance-based check, WITHOUT duplicating its MAX_INTRO_DURATION_SECONDS
// cap (private to ffmpeg.ts) - a segment that got capped would make this estimate slightly high,
// which only makes a real drift LESS likely to trip the warning, never more (a deliberately
// conservative approximation, not a source of false positives). Returns null when the segment's
// own contribution genuinely can't be estimated (an image with no known duration) - the caller
// skips verification entirely rather than compare against a guessed number.
async function estimateBrandSegmentDurationSeconds(
  filePath: string,
  segment: { type: 'video' | 'image'; imageDurationSeconds: number | null },
): Promise<number | null> {
  if (segment.type === 'image') {
    return segment.imageDurationSeconds;
  }
  return getMediaDurationSeconds(filePath);
}

// Render Fidelity Matrix bug fix #5 - "focused verification step" per the fix's own scope
// boundary (explicitly NOT the full Render Manifest/RenderPlan duration-accounting architecture
// described in docs/ai/render-fidelity-matrix.md's larger proposal). Reconstructs the expected
// final duration from numbers this same render already computed locally (the original requested
// span, cuts actually removed, reaction-hold time actually inserted, brand segment durations
// actually concatenated) and compares it against the REAL final media duration via ffprobe -
// never trusts `endTime - startTime` alone, since that's exactly the number every one of the 6
// bugs this fix addresses could silently diverge from. Best-effort and non-fatal by design (the
// same "unverifiable -> warn, continue" branch of the existing render error model
// verifyUploadChecksum() already establishes above, not its "confirmed corruption -> throw"
// branch) - a duration mismatch means the render's own timing may be off, not that the file is
// corrupted or unplayable, so it must never fail an otherwise-successful render.
async function verifyRenderedDuration(params: {
  clipId: string;
  finalOutputPath: string;
  requestedDurationSeconds: number;
  trimApplied: boolean;
  removedSeconds: number;
  reactionHoldDurationSeconds: number;
  introPath: string | null;
  intro: { type: 'video' | 'image'; imageDurationSeconds: number | null } | null;
  outroPath: string | null;
  outro: { type: 'video' | 'image'; imageDurationSeconds: number | null } | null;
}): Promise<void> {
  const {
    clipId,
    finalOutputPath,
    requestedDurationSeconds,
    trimApplied,
    removedSeconds,
    reactionHoldDurationSeconds,
    introPath,
    intro,
    outroPath,
    outro,
  } = params;
  try {
    let expectedDurationSeconds = requestedDurationSeconds;
    if (trimApplied) expectedDurationSeconds -= removedSeconds;
    expectedDurationSeconds += reactionHoldDurationSeconds;

    if (introPath && intro) {
      const introDuration = await estimateBrandSegmentDurationSeconds(introPath, intro);
      if (introDuration === null) {
        logger.info('skipping duration verification - intro segment duration unknown', { clipId });
        return;
      }
      expectedDurationSeconds += introDuration;
    }
    if (outroPath && outro) {
      const outroDuration = await estimateBrandSegmentDurationSeconds(outroPath, outro);
      if (outroDuration === null) {
        logger.info('skipping duration verification - outro segment duration unknown', { clipId });
        return;
      }
      expectedDurationSeconds += outroDuration;
    }

    const actualDurationSeconds = await getMediaDurationSeconds(finalOutputPath);
    const deltaSeconds = actualDurationSeconds - expectedDurationSeconds;

    if (Math.abs(deltaSeconds) > DURATION_VERIFICATION_TOLERANCE_SECONDS) {
      logger.warn('rendered clip duration diverges from expected duration beyond tolerance', {
        clipId,
        expectedDurationSeconds: Number(expectedDurationSeconds.toFixed(2)),
        actualDurationSeconds: Number(actualDurationSeconds.toFixed(2)),
        deltaSeconds: Number(deltaSeconds.toFixed(2)),
        toleranceSeconds: DURATION_VERIFICATION_TOLERANCE_SECONDS,
      });
    } else {
      logger.info('rendered clip duration verified within tolerance', {
        clipId,
        expectedDurationSeconds: Number(expectedDurationSeconds.toFixed(2)),
        actualDurationSeconds: Number(actualDurationSeconds.toFixed(2)),
      });
    }
  } catch (error) {
    // Never fails the job over a verification step itself failing (e.g. ffprobe unavailable) -
    // same best-effort posture as every other optional pass in this file.
    logger.warn('duration verification itself failed, skipping', { clipId }, error);
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

// Phase 3 (Animated Thumbnail roadmap) - same config as transcribe.worker.ts's
// own animated thumbnail (see its own comment for the reasoning).
const ANIMATED_THUMBNAIL_CONFIG = { durationSeconds: 1.5, fps: 6, width: 480 };

// Phase 3 (Hover Preview roadmap, "Clip Preview" on a clip card) - same
// config as transcribe.worker.ts's own hover preview.
const HOVER_PREVIEW_CONFIG = { durationSeconds: 3, fps: 12, width: 320 };

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
            speakerColorCaptions,
            smartSegmentation,
            dynamicCaptions,
            captionLanguage,
            fontFamily,
            watermark,
            intro,
            outro,
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
            // video.title (Notification Center Sprint 4A) - needed for the
            // CLIP_READY notification below, same reasoning.
            // video.processingOptions (Pre-Processing Settings roadmap,
            // Phase 0/1) - resolves this render's export quality, see
            // resolveRenderQuality above.
            // hookText (Pre-Processing Settings roadmap, Phase 3) - the
            // same "clip has no AI-generated hook yet" guard
            // ClipsService.generatePlatformCopy() itself uses, see
            // triggerAutoPlatformCopy below.
            select: {
              outputUrl: true,
              hookText: true,
              video: { select: { ownerId: true, title: true, processingOptions: true } },
            },
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

          // Pre-Processing Settings roadmap - resolved once, reused for
          // export quality, scene-analysis toggles, and crop aggressiveness
          // below. migrateProcessingOptions() (not a bare cast) so a future
          // version bump is handled in exactly one place.
          const processingOptions = existingClip.video.processingOptions
            ? migrateProcessingOptions(existingClip.video.processingOptions)
            : null;
          // Output Resolution/Quality audit, Phase 0 (quality-propagation fix) - resolved
          // once here (not inline at renderClip()'s own call site below) so the SAME value
          // also reaches trimCutRanges()/applyReactionHolds() further down. Before this fix,
          // those two later re-encode passes never received the user's chosen preset/crf at
          // all and silently fell back to ffmpeg's own default (CRF 23, medium) - so a clip
          // with silence cuts or a reaction hold lost whatever quality was picked, even though
          // the FIRST pass (renderClip()) honored it correctly.
          const quality = resolveRenderQuality(processingOptions);

          let sourcePath: string | null = null;
          let subtitlesPath: string | null = null;
          let outputPath: string | null = null;
          let trimmedPath: string | null = null;
          // Visual Emphasis Engine Phase C6R.3 (Reaction Hold) - only ever
          // set when computeReactionHoldInstants() finds at least one
          // surviving hold instant; stays null (nothing extra to clean up)
          // when the flag is off, there are no reaction_hold suggestions,
          // or every instant got remapped to null (cut away entirely).
          let reactionHoldPath: string | null = null;
          let sendCmdPath: string | null = null;
          let brollPaths: string[] = [];
          let watermarkPath: string | null = null;
          let introPath: string | null = null;
          // Only ever set when concatBrandSegment() actually creates a NEW
          // scratch file below - stays null (nothing extra to clean up)
          // whenever there's no intro, or concat fails and the pipeline
          // falls back to uploading the plain renderedPath (already covered
          // by outputPath/trimmedPath's own cleanup entries).
          let introConcatPath: string | null = null;
          // Outro roadmap (P3e) - same shape as introPath/introConcatPath.
          let outroPath: string | null = null;
          let outroConcatPath: string | null = null;
          let thumbPath: string | null = null;
          let blurPath: string | null = null;
          let animatedThumbnailPath: string | null = null;
          let hoverPreviewPath: string | null = null;
          const storyboardPaths: string[] = [];

          try {
            // ffmpeg needs a real local file to seek within - download the
            // source from object storage into scratch space first.
            sourcePath = await reserveScratchPath('source', path.extname(sourceUrl) || '.mp4');
            const sourceStream = await getObjectStream(sourceUrl);
            await pipeline(sourceStream, createWriteStream(sourcePath));

            // Computed before the render graph - compositionFeaturesNode needs
            // the final (post-crop) output dimensions for its own aspect-ratio-
            // aware thresholds, and buildAss() needs them too. Visual Emphasis
            // Engine Phase C2 split the old buildReframePlan() in two exactly
            // here: dimensions only need the source video's own width/height,
            // genuinely independent of face/subject detection - see
            // computeReframeDimensions()'s own comment.
            const {
              crop,
              outputSize,
              sourceWidth,
              sourceHeight,
              aspectRatioLabel,
              sourceFrameRate,
              clampedAudioChannels,
              sourceAudioChannels,
            } = await computeReframeDimensions(sourcePath, processingOptions);

            // Render Fidelity & Composition Execution Engine, Phase 1 (EffectiveRenderConfig) -
            // see packages/contracts/src/render-config.ts's own module comment and
            // docs/ai/render-fidelity-matrix.md for the full design/scope-boundary reasoning.
            // Built and logged (CONFIG_RESOLVED, mission-brief section 17's own observability
            // convention) purely as a proof-of-integration for this Foundation phase - NOT yet
            // consumed by any ffmpeg-facing code below. Every existing resolveRenderQuality()/
            // resolveTargetAspectRatio()/resolveResolutionTier()/resolveZoomInFraction()/
            // resolveBRollOptions()/resolveSceneAnalysisFlags() call further down this file is
            // UNCHANGED and remains the actual source of truth driving this render - see
            // @speedora/render-config's own module comment for why the cutover is a deliberately
            // separate, later phase, once this object's output is proven to agree with those
            // helpers across real renders (this log line IS that proof-gathering mechanism).
            // The 6 isXEnabled() feature-flag reads happen HERE, once, rather than being left for
            // a later ffmpeg-facing function to read env vars directly - exactly what the mission
            // brief's "the renderer must NOT independently read... environment variables" rule
            // requires, even though nothing downstream consumes the resolved booleans yet.
            const effectiveRenderConfig = buildEffectiveRenderConfig({
              clipId,
              videoId,
              sourceWidth,
              sourceHeight,
              processingOptions: toRenderConfigProcessingOptions(processingOptions),
              clipOverrides: {
                captionStyle,
                speakerColorCaptions,
                smartSegmentation,
                dynamicCaptions,
                captionLanguage,
                fontFamily,
                watermark,
                intro,
                outro,
              },
              featureFlags: {
                ocrHighlightEnabled: isOcrHighlightEnabled(),
                focusShiftEnabled: isFocusShiftEnabled(),
                digitalPushEnabled: isDigitalPushEnabled(),
                reactionHoldEnabled: isReactionHoldEnabled(),
                pauseHoldEnabled: isPauseHoldEnabled(),
                speakerAwareFocusShiftEnabled: isSpeakerAwareFocusShiftEnabled(),
              },
            });
            logger.info('CONFIG_RESOLVED', { clipId, videoId, effectiveRenderConfig });

            // Render Fidelity & Composition Execution Engine, Phase 2 (OutputProfile) - see
            // packages/contracts/src/output-profile.ts's own module comment for the full
            // scope-boundary reasoning. Same proof-of-integration-only posture as Phase 1 above:
            // built and logged (OUTPUT_PROFILE_RESOLVED) purely to prove this canonical object
            // agrees with what the existing pipeline already does - NOT yet consumed by any
            // ffmpeg-facing code. `outputSize`/`crop` (from computeReframeDimensions() above) are
            // the pipeline's own REAL, currently-in-effect resolution - buildOutputProfile()
            // deliberately does NOT read them, since the whole point of this phase is to prove
            // its OWN independent computation (via the same reusable computeCropDimensions()/
            // resolveOutputResolution() calls, just invoked a second time here) lands on the
            // identical answer, not to just copy the existing one forward.
            //
            // Source media characteristics, all plain data (no ffprobe/subprocess call happens in
            // packages/render-config itself):
            // - width/height/frameRate: the same sourceWidth/sourceHeight/sourceFrameRate already
            //   probed above for computeReframeDimensions().
            // - audioSampleRate: this pipeline has no per-source PROBED sample rate anywhere
            //   (only a channel-count probe, getAudioChannelCount()) - 44100 mirrors the one real
            //   sample-rate concept that exists today, ffmpeg.ts's own (unexported)
            //   BRAND_SEGMENT_AUDIO_SAMPLE_RATE constant that trimCutRanges()'s crossfade join/
            //   applyReactionHolds()/concatBrandSegment() already normalize every audio stream to.
            // - audioChannels: clampedAudioChannels ?? 2 - the SAME already-clamped value passed
            //   to trimCutRanges()/applyReactionHolds()/concatBrandSegment() today (never
            //   re-clamped here), falling back to the stereo-equivalent default only when the
            //   channel-count probe itself failed, matching resolveAudioEncodeArgs()'s own
            //   documented "null -> stereo-equivalent" convention (ffmpeg.ts).
            const outputProfile = buildOutputProfile({
              effectiveRenderConfig,
              sourceMedia: {
                width: sourceWidth,
                height: sourceHeight,
                frameRate: sourceFrameRate,
                audioSampleRate: 44100,
                audioChannels: clampedAudioChannels ?? 2,
              },
            });
            logger.info('OUTPUT_PROFILE_RESOLVED', { clipId, videoId, outputProfile });

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
              reframe: { outputWidth: outputSize.width, outputHeight: outputSize.height },
              sceneAnalysis: resolveSceneAnalysisFlags(processingOptions),
              thumbnailWeights: resolveThumbnailWeights(processingOptions),
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

            // Visual Emphasis Engine Phase C2 (docs/ai/visual-emphasis-engine.md,
            // ADR DC3) - built AFTER the render graph specifically so it can
            // consume graphResult.primarySubjectSamples (Composition
            // Intelligence's own selectPrimarySubject() chain) instead of a
            // second, disconnected face detector call - see buildReframePlan()'s
            // own comment for the full "before/after" story.
            //
            // Phase C3 ("Focus Shift")/Phase C4 ("Digital Push")/Phase C5
            // ("OCR Highlight") - graphResult.editingSuggestions/ocrTracks
            // are ALWAYS computed (Phase C1/OCR-2's own render-graph nodes,
            // optional: false), regardless of any Visual Emphasis Engine
            // flag (those flags gate GET /clips/:id/intelligence's
            // exposure and/or Ops surfaces only). Passed through UNFILTERED
            // and UNCONDITIONALLY here - buildReframePlan() itself checks
            // each technique's own flag (isFocusShiftEnabled()/
            // isDigitalPushEnabled()/isOcrHighlightEnabled()) before acting
            // on that technique's entries (docs/ai/visual-emphasis-engine.md's
            // "C4 rollout" note: one flag per technique, never a shared
            // master flag, so each can be calibrated independently in
            // production).
            const { reframe, ocrHighlights, cropPath } = await buildReframePlan(
              graphResult.primarySubjectSamples,
              transcript,
              startTime,
              crop,
              outputSize,
              sourceWidth,
              sourceHeight,
              endTime - startTime,
              resolveZoomInFraction(processingOptions),
              graphResult.editingSuggestions,
              graphResult.ocrTracks,
            );
            sendCmdPath = reframe.sendCmdPath;

            // Composing multiple modules: the render-clip Feature Orchestrator (see
            // ARCHITECTURE.md) - toFusionInput() replaces this call's former hand-written object
            // literal, translating each graph node's own id into computeHighlightScore's FUSION_SIGNALS
            // vocabulary via FUSION_INPUT_MAP (render-graph/sinks.ts) so the mapping lives in exactly
            // one place instead of being duplicated across this call and the prisma.clip.update() call
            // below.
            const highlight = computeHighlightScore(toFusionInput(graphResult, clipId, scores));

            // AI B-roll Recommendation UI control - resolved once, same "resolve then branch"
            // shape resolveRenderQuality/resolveSceneAnalysisFlags already use. Disabled skips
            // buildBRollOverlays() (and therefore findBRollMoments()/every stock-asset search)
            // entirely, rather than running the search and discarding its results.
            //
            // graphResult.hookPrediction's own namedEntities (real classification signal,
            // now genuinely free - see broll.ts's looksLikeBrandName()/matchesNamedEntity()
            // comments for the pipeline-order history) - null/undefined only when that LLM
            // call itself failed, in which case broll.ts's own capitalization heuristic is
            // the sole fallback, exactly like before this signal existed.
            const brollOptions = resolveBRollOptions(processingOptions);
            const { overlays: broll, finalPaths } = brollOptions.enabled
              ? await buildBRollOverlays(
                  keywords,
                  toClipRelativeWords(transcript, startTime),
                  endTime - startTime,
                  reframe.outputWidth,
                  reframe.outputHeight,
                  brollOptions.maxMoments,
                  graphResult.hookPrediction?.linguisticFeatures.namedEntities ?? [],
                  sourceFrameRate,
                )
              : { overlays: [], finalPaths: [] };
            brollPaths = finalPaths;

            // Watermark roadmap (P3c) - same "getObjectStream + scratch path
            // + pipeline" idiom as the source video download above, and the
            // same "best-effort, never fail the job" posture as the
            // thumbnail/blur-placeholder/animated-preview extractions below -
            // a watermark that fails to download just renders without one,
            // rather than failing an otherwise-successful render.
            if (watermark) {
              try {
                watermarkPath = await reserveScratchPath(
                  'watermark',
                  path.extname(watermark.key) || '.png',
                );
                const watermarkStream = await getObjectStream(watermark.key);
                await pipeline(watermarkStream, createWriteStream(watermarkPath));
              } catch (error) {
                logger.warn('watermark download failed, rendering without one', { clipId }, error);
                watermarkPath = null;
              }
            }

            // Intro roadmap (P3d) - same best-effort download shape as
            // watermark above. Downloaded here (not later, alongside the
            // concat pass itself) so a slow/failing download doesn't waste
            // the crop/B-roll/subtitles/watermark render work that follows.
            if (intro) {
              try {
                introPath = await reserveScratchPath(
                  'intro',
                  path.extname(intro.key) || (intro.type === 'video' ? '.mp4' : '.png'),
                );
                const introStream = await getObjectStream(intro.key);
                await pipeline(introStream, createWriteStream(introPath));
              } catch (error) {
                logger.warn('intro download failed, rendering without one', { clipId }, error);
                introPath = null;
              }
            }

            // Outro roadmap (P3e) - same best-effort download shape as
            // intro above.
            if (outro) {
              try {
                outroPath = await reserveScratchPath(
                  'outro',
                  path.extname(outro.key) || (outro.type === 'video' ? '.mp4' : '.png'),
                );
                const outroStream = await getObjectStream(outro.key);
                await pipeline(outroStream, createWriteStream(outroPath));
              } catch (error) {
                logger.warn('outro download failed, rendering without one', { clipId }, error);
                outroPath = null;
              }
            }

            // AI Intelligence v4 Track B, Phase A2 (ADR DB10, docs/ai/
            // subtitle-intelligence.md) - double-gated: the per-clip
            // `smartSegmentation` toggle (Clip.smartSegmentation, same
            // orthogonal-to-captionStyle shape as speakerColorCaptions) AND
            // the global SUBTITLE_REWRITE_ENABLED kill switch must both be
            // on. Also disabled whenever a translation is requested
            // (captionLanguage set) - Clip.subtitleIntelligence is always
            // computed against the ORIGINAL-language transcript (same
            // "translated captions have no reliable word-level timing" gap
            // toSubtitleSegments' own comment already documents for
            // karaoke), so applying it under a translation would silently
            // show the wrong language rather than degrade gracefully.
            const useSmartSegmentation =
              smartSegmentation && isSubtitleRewriteEnabled() && !captionLanguage;
            // AI Intelligence v4 Track B, Phase B2 (ADR DB11, docs/ai/
            // subtitle-intelligence.md) - a THIRD gate layered on top of
            // useSmartSegmentation, since Clip.captionTreatment's
            // TreatmentMoment[] is only meaningful when captions actually
            // come from Clip.subtitleIntelligence's own lines (see
            // toSubtitleSegments' own index-zip comment) - dynamic captions
            // can never apply without smart segmentation also being active
            // this render, even if a clip somehow has dynamicCaptions on
            // and smartSegmentation off.
            const useDynamicCaptions =
              dynamicCaptions && isDynamicCaptionEnabled() && useSmartSegmentation;
            const assContent = buildAss({
              segments: toSubtitleSegments(
                transcript,
                captionLanguage,
                useSmartSegmentation ? graphResult.subtitleIntelligence.timeline : null,
                startTime,
                useDynamicCaptions ? graphResult.captionTreatment : null,
              ),
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
              speakerColorCaptions,
              // Brand Kit roadmap (P3a) - job.data.fontFamily is null when
              // Clip.applyBrandKit is false or the owner never set one; the
              // 'Inter' literal here mirrors buildAssInputSchema's own
              // default, spelled out explicitly since BuildAssInput's
              // z.infer makes fontFamily a required field despite the
              // schema's .default() (same z.infer + .default() gotcha
              // speakerColorCaptions/captionLanguage's own tests hit - see
              // build-ass.spec.ts). The cast mirrors captionStyle's own just
              // above - fontFamily is re-validated against the same
              // FONT_FAMILIES list inside buildAss() regardless.
              fontFamily: (fontFamily ?? 'Inter') as FontFamily,
              // Visual Emphasis Engine Phase C5 ("OCR Highlight") -
              // buildReframePlan()'s own computeOcrHighlightBoxes() output,
              // already clip-relative and already in absolute OUTPUT-frame
              // pixel coordinates - buildAss() must NOT re-shift these by
              // clipStart (see buildAssInputSchema's own field comment).
              // Empty array (isOcrHighlightEnabled() off, the default)
              // reproduces buildAss()'s exact pre-C5 output byte-for-byte.
              ocrHighlights,
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
              watermark:
                watermarkPath && watermark
                  ? {
                      filePath: watermarkPath,
                      opacity: watermark.opacity,
                      scale: watermark.scale,
                      margin: watermark.margin,
                      position: watermark.position,
                    }
                  : null,
              quality,
              sourceAudioChannels,
            });

            // Second pass (see computeClipCuts's comment) - skipped entirely
            // when there's nothing to cut, so a clip with no long pauses/filler
            // words renders exactly as it did before this feature existed.
            // graphResult.editingSuggestions passed through unconditionally
            // (Phase C1's own output, always computed) - computeClipCuts()
            // itself checks isPauseHoldEnabled() before acting on any
            // pause_hold entries within it (Phase C7).
            const cuts = computeClipCuts(
              transcript,
              startTime,
              endTime,
              graphResult.editingSuggestions,
            );
            let renderedPath = outputPath;
            // Render Fidelity Matrix bug fix #5 (docs/ai/render-fidelity-matrix.md) - tracked
            // separately from `renderedPath`/`trimmedPath` themselves, which get overwritten by
            // LATER passes (reaction hold, intro/outro) - these two flags/values capture each
            // pass's own success at the moment it happens, so the duration-verification step
            // below can reconstruct "what should the final duration be" even after renderedPath
            // has moved on to a later pass's output.
            let trimApplied = false;
            let reactionHoldDurationSeconds = 0;
            // Render Fidelity & Composition Execution Engine, Phase 3 (RenderPlan) - mirrors
            // reactionHoldDurationSeconds' own "only reflects what actually happened" semantics:
            // stays [] unless applyReactionHolds() below genuinely succeeds, so RenderPlan.holds
            // never claims a hold was applied when the pass failed or the flag was off.
            let reactionHoldInstants: number[] = [];
            if (cuts.length > 0) {
              trimmedPath = await reserveScratchPath('trimmed', '.mp4');
              const totalOutputDuration = endTime - startTime - totalCutSeconds(cuts);
              // Optional polish, not required for a correct clip - the untrimmed render above is
              // already a complete, valid output. Caught (not left to fail the whole job) for the same
              // "external ffmpeg call, bounded by TRIM_TIMEOUT_MS but still allowed to fail" reasoning
              // as every other optional signal in this file, prompted by a real timeout observed here.
              try {
                await trimCutRanges(
                  outputPath,
                  trimmedPath,
                  cuts,
                  totalOutputDuration,
                  quality,
                  sourceFrameRate,
                  clampedAudioChannels,
                );
                renderedPath = trimmedPath;
                trimApplied = true;
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

            // Visual Emphasis Engine Phase C6R.3 ("Reaction Hold Temporal
            // Extension", docs/ai/visual-emphasis-engine.md) - the C6R
            // design's own "third pass, after cuts" (on renderedPath as it
            // stands right now: cropped + captioned + B-roll composed, AND
            // already cut-trimmed) - freezing a frame of THIS output
            // automatically freezes whatever crop/caption/B-roll pixel was
            // showing at that instant, correctly, for free - no separate
            // caption/crop-path/B-roll remapping needed, same reasoning
            // Phase C7's own cuts pass above already relies on.
            // graphResult.editingSuggestions passed through unconditionally
            // (Phase C1's own output, always computed); the SAME `cuts`
            // array just used for trimCutRanges() above is reused here so
            // reaction_hold instants remap onto the ACTUAL post-cut
            // timeline, including any Phase C7 pause-hold protection -
            // computeReactionHoldInstants() itself filters to
            // technique === 'reaction_hold', and this whole pass is gated
            // by isReactionHoldEnabled() right here, same "each technique
            // checks its own flag at its own call site" shape C3/C4/C5/C7
            // already established.
            if (isReactionHoldEnabled()) {
              const holdInstants = computeReactionHoldInstants(
                graphResult.editingSuggestions,
                cuts,
                REACTION_HOLD_EXTENSION_SECONDS,
              );
              if (holdInstants.length > 0) {
                reactionHoldPath = await reserveScratchPath('reaction-hold', '.mp4');
                // Optional polish, not required for a correct clip - same
                // "external ffmpeg call, allowed to fail without failing
                // the whole job" posture as the cutlist trim pass above.
                try {
                  await applyReactionHolds(
                    renderedPath,
                    reactionHoldPath,
                    holdInstants,
                    REACTION_HOLD_EXTENSION_SECONDS,
                    quality,
                    clampedAudioChannels,
                  );
                  renderedPath = reactionHoldPath;
                  reactionHoldInstants = holdInstants;
                  reactionHoldDurationSeconds =
                    holdInstants.length * REACTION_HOLD_EXTENSION_SECONDS;
                  logger.info('applied reaction holds', {
                    clipId,
                    holdCount: holdInstants.length,
                  });
                } catch (error) {
                  logger.warn(
                    'reaction hold pass failed, keeping the pre-hold render',
                    { clipId },
                    error,
                  );
                }
              }
            }

            // Render Fidelity & Composition Execution Engine, Phase 3 (RenderPlan) - see
            // packages/contracts/src/render-plan.ts's own module comment for the full
            // architectural-position reasoning. Built HERE, not right after Phase 1/2's own
            // CONFIG_RESOLVED/OUTPUT_PROFILE_RESOLVED - this is the first point in the pipeline
            // where every decision RenderPlan captures (cropPath, reframeHints, reaction hold
            // instants/duration, B-roll overlays) has actually been made. Deliberately still
            // BEFORE the intro/outro pass below: RenderPlan.overlays.watermark/intro/outro are
            // presence-only booleans derived from effectiveRenderConfig.branding (resolved back
            // in Phase 1, long before this point) - RenderPlan does not need intro/outro's OWN
            // concat pass to have run, only to know whether one is configured.
            //
            // Same proof-of-integration-only posture as Phase 1/2: logged (RENDER_PLAN_RESOLVED)
            // purely to prove this snapshot agrees with what the existing pipeline already
            // decided - NOT yet consumed by any ffmpeg-facing code. Every existing pass below
            // (intro/outro concat, duration verification, upload) is UNCHANGED and continues to
            // read its own already-resolved local variables directly, exactly as before this
            // phase existed.
            const renderPlan = buildRenderPlan({
              clipId,
              videoId,
              effectiveRenderConfig,
              outputProfile,
              requestedStartTime: startTime,
              requestedEndTime: endTime,
              trimApplied,
              removedSeconds: totalCutSeconds(cuts),
              reactionHoldInstants,
              reactionHoldDurationSeconds,
              cropPath,
              reframeHints: ocrHighlights,
              broll,
            });
            // Summary only - deliberately omits the full cropPath keyframe array (can be
            // hundreds of points for a long clip) and never logs transcript content, matching
            // this file's own existing "no huge payloads in normal logs" logging discipline
            // (see e.g. the 'removed silence/filler cuts' log above, which logs cutCount/
            // removedSeconds rather than the cuts array itself).
            logger.info('RENDER_PLAN_RESOLVED', {
              clipId,
              videoId,
              version: renderPlan.version,
              timeline: renderPlan.timeline,
              holds: {
                reactionHoldCount: renderPlan.holds.reactionHoldInstants.length,
                reactionHoldDurationSeconds: renderPlan.holds.reactionHoldDurationSeconds,
              },
              framing: {
                cropPathPointCount: renderPlan.framing.cropPath?.length ?? 0,
                reframeHintCount: renderPlan.framing.reframeHints.length,
              },
              overlays: {
                brollCount: renderPlan.overlays.broll.length,
                watermark: renderPlan.overlays.watermark,
                intro: renderPlan.overlays.intro,
                outro: renderPlan.overlays.outro,
              },
              transitions: renderPlan.transitions,
            });

            // Intro/Outro roadmap (P3d/P3e) - originally documented as "a
            // THIRD (and, when both are configured, fourth) pass, after the
            // cutlist trim above" - now the FOURTH (and, when both intro
            // and outro are configured, fifth) pass, since Visual Emphasis
            // Engine Phase C6R.3 (Reaction Hold, above) inserted its own
            // pass between the cutlist trim and this one. Still correct
            // regardless of the exact count: prepending/appending the
            // Brand Kit intro/outro onto the fully-finished clip (crop/
            // B-roll/subtitles/watermark/cutlist-trim/reaction-hold already
            // applied). finalOutputPath (not renderedPath) is
            // what gets checksummed/uploaded/sized below - thumbnail/
            // storyboard/hover-preview extraction further down deliberately
            // keeps reading renderedPath unchanged, so a thumbnail
            // represents the clip's own highlight content, not a generic
            // intro/outro card. Each pass is independently best-effort, same
            // "degrade gracefully, never fail the job" posture as watermark/
            // B-roll: a concat failure just uploads the clip without that
            // one segment rather than failing an otherwise-successful
            // render - an outro failure after a successful intro concat
            // still uploads the intro+clip result, not nothing. The outro
            // pass chains onto whatever the intro pass already produced
            // (or renderedPath, if there was no intro), reusing the exact
            // same concatBrandSegment() call shape with position: 'end'
            // instead of 'start' - see that function's own comment for why
            // this is a sequential two-pass composition rather than a
            // single 3-way concat.
            let finalOutputPath = renderedPath;
            if (introPath && intro) {
              try {
                introConcatPath = await reserveScratchPath('with-intro', '.mp4');
                await concatBrandSegment(
                  'start',
                  finalOutputPath,
                  {
                    filePath: introPath,
                    type: intro.type,
                    imageDurationSeconds: intro.imageDurationSeconds,
                  },
                  reframe.outputWidth,
                  reframe.outputHeight,
                  introConcatPath,
                  quality,
                  sourceFrameRate,
                  clampedAudioChannels,
                );
                finalOutputPath = introConcatPath;
              } catch (error) {
                logger.warn('intro concat failed, uploading without one', { clipId }, error);
              }
            }
            if (outroPath && outro) {
              try {
                outroConcatPath = await reserveScratchPath('with-outro', '.mp4');
                await concatBrandSegment(
                  'end',
                  finalOutputPath,
                  {
                    filePath: outroPath,
                    type: outro.type,
                    imageDurationSeconds: outro.imageDurationSeconds,
                  },
                  reframe.outputWidth,
                  reframe.outputHeight,
                  outroConcatPath,
                  quality,
                  sourceFrameRate,
                  clampedAudioChannels,
                );
                finalOutputPath = outroConcatPath;
              } catch (error) {
                logger.warn('outro concat failed, uploading without one', { clipId }, error);
              }
            }

            // Render Fidelity Matrix bug fix #5 (docs/ai/render-fidelity-matrix.md) - a focused,
            // best-effort check that the ACTUAL final media duration matches what this render's
            // own passes should have produced; see verifyRenderedDuration()'s own comment.
            await verifyRenderedDuration({
              clipId,
              finalOutputPath,
              requestedDurationSeconds: endTime - startTime,
              trimApplied,
              removedSeconds: totalCutSeconds(cuts),
              reactionHoldDurationSeconds,
              introPath,
              intro,
              outroPath,
              outro,
            });

            // Render Fidelity & Composition Execution Engine, Phase 4 (FFmpeg Execution
            // Compiler) - see apps/worker/src/render-plan-compiler.ts's own module comment for
            // the full design/scope-boundary reasoning. Built HERE, after the intro/outro pass
            // and verifyRenderedDuration() above (not right after RenderPlan itself) - the real
            // introConcatPath/outroConcatPath/trimmedPath/reactionHoldPath scratch paths are only
            // ever reserved (reserveScratchPath()) lazily, inside each pass's own `if` block,
            // exactly when that pass actually runs; this is the first point where all of them
            // hold their real, final values (still null when that pass never ran, matching
            // compileRenderPlan()'s own "?? ''" - never read in that case, since the plan
            // correctly omits that pass whenever RenderPlan shows nothing to do).
            //
            // Same proof-of-integration-only posture as Phases 1-3: logged
            // (RENDER_EXECUTION_PLAN_COMPILED) purely to prove this compiled plan agrees with
            // what the existing pipeline already executed - NOT yet used to drive execution.
            // Every ffmpeg.ts call above this point is UNCHANGED and remains the actual
            // execution path; the cutover to actually run FROM the compiled plan is a
            // deliberately separate, later phase (Phase 5).
            const executionPlan = compileRenderPlan(renderPlan, {
              sourcePath,
              outputPath,
              trimmedPath: trimmedPath ?? '',
              reactionHoldPath: reactionHoldPath ?? '',
              introConcatPath: introConcatPath ?? '',
              outroConcatPath: outroConcatPath ?? '',
              subtitlesPath,
              watermarkPath,
              introPath,
              outroPath,
              brollOverlayPaths: broll.map(({ keyword, startTime, filePath }) => ({
                keyword,
                startTime,
                filePath,
              })),
              cuts,
              sourceAudioChannels,
              reframe,
            });
            logger.info('RENDER_EXECUTION_PLAN_COMPILED', {
              clipId,
              videoId,
              passes: executionPlan.passes.map((compiledPass) =>
                compiledPass.pass === 'concatBrandSegment'
                  ? `${compiledPass.pass}:${compiledPass.position}`
                  : compiledPass.pass,
              ),
            });

            const outputKey = `renders/${clipId}.mp4`;
            // Computed before the upload, from the exact same local file the
            // upload is about to stream - see verifyUploadChecksum's comment.
            const expectedMd5 = await computeFileMd5Hex(finalOutputPath);
            // Sprint 1-2 (Dashboard Redesign) - the file's already on disk
            // (same file computeFileMd5Hex just streamed), so this costs
            // nothing extra. Feeds the Dashboard's per-owner Storage Used
            // stat - see Clip.outputSizeBytes.
            const { size: outputSizeBytes } = await stat(finalOutputPath);
            // Streamed straight from disk (not read into a Buffer first) - same
            // "no timeout at all on a plain readFile()" reasoning as
            // import-youtube.worker.ts's own upload, now applied here too. A
            // rendered clip can be tens to hundreds of MB, and this makes the
            // step subject to uploadObject's own requestTimeout instead of
            // being able to hang indefinitely.
            const etag = await uploadObject(
              outputKey,
              createReadStream(finalOutputPath),
              'video/mp4',
            );
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
            // Phase 4 of the thumbnail roadmap (AI Thumbnail Selection, Level
            // 2) - graphResult.thumbnailSelection.timestampSeconds replaces
            // the naive (endTime - startTime) / 2 midpoint. Deliberately
            // reads ONLY graphResult, never `highlight` (Fusion Engine's
            // clip-level highlightScore, computed further down in this file)
            // - highlightScore has no per-timestamp meaning, see
            // @speedora/contracts' thumbnail-selection.ts for why that
            // boundary is load-bearing. Degrades to exactly today's midpoint
            // whenever the selector had no timed signals to work with (see
            // its own 'midpoint' fallback level).
            const thumbTimestamp = graphResult.thumbnailSelection.timestampSeconds;
            try {
              thumbPath = await reserveScratchPath('thumbnail', '.webp');
              await extractThumbnail(renderedPath, thumbPath, thumbTimestamp);
              thumbnailKey = `thumbnails/${clipId}.webp`;
              await uploadObject(thumbnailKey, createReadStream(thumbPath), 'image/webp');

              // Phase 2 (image optimization roadmap) - same "own best-effort
              // block, doesn't undo an otherwise-successful thumbnail" idiom
              // as transcribe.worker.ts's own blur placeholder extraction.
              try {
                blurPath = await reserveScratchPath('thumbnail-blur', '.webp');
                await extractBlurPlaceholder(renderedPath, blurPath, thumbTimestamp);
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

            // Phase 3 (Animated Thumbnail roadmap) - same best-effort idiom
            // as thumbnailKey above, extracted from renderedPath for the same
            // "matches what the viewer sees" reason.
            let animatedThumbnailKey: string | null = null;
            try {
              animatedThumbnailPath = await reserveScratchPath('animated-thumbnail', '.webp');
              await extractAnimatedPreview(
                renderedPath,
                animatedThumbnailPath,
                (endTime - startTime) / 2,
                ANIMATED_THUMBNAIL_CONFIG,
              );
              animatedThumbnailKey = `animated-thumbnails/${clipId}.webp`;
              await uploadObject(
                animatedThumbnailKey,
                createReadStream(animatedThumbnailPath),
                'image/webp',
              );
            } catch (error) {
              animatedThumbnailKey = null;
              logger.warn(
                'animated thumbnail extraction failed, continuing without one',
                { clipId },
                error,
              );
            }

            // Phase 3 (Hover Preview roadmap, "Clip Preview") - same
            // best-effort idiom as animatedThumbnailKey above.
            let hoverPreviewKey: string | null = null;
            try {
              hoverPreviewPath = await reserveScratchPath('hover-preview', '.webp');
              await extractAnimatedPreview(
                renderedPath,
                hoverPreviewPath,
                (endTime - startTime) / 2,
                HOVER_PREVIEW_CONFIG,
              );
              hoverPreviewKey = `hover-previews/${clipId}.webp`;
              await uploadObject(hoverPreviewKey, createReadStream(hoverPreviewPath), 'image/webp');
            } catch (error) {
              hoverPreviewKey = null;
              logger.warn(
                'hover preview extraction failed, continuing without one',
                { clipId },
                error,
              );
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
            // Notification Center v2 Phase 2 - real, already-computed counts
            // (never a fabricated/interpolated percentage) for the Smart
            // Timeline's rendering-progress update below - see the
            // recordThreadNotification call after this block.
            let renderProgress = { renderedCount: 0, totalCount: 0 };
            try {
              const result = await prisma.$transaction(async (tx) => {
                await tx.clip.update({
                  where: { id: clipId, outputUrl: null },
                  data: toClipUpdateData(graphResult, {
                    outputUrl: outputKey,
                    outputSizeBytes,
                    // Output Resolution/Quality audit - the RENDERED output's actual pixel
                    // dimensions. outputSize (NOT crop) - crop is the natural, source-bounded
                    // crop region; outputSize is what the clip is actually ENCODED at after
                    // resolveOutputResolution()'s normalization (see computeReframeDimensions()'s
                    // own comment for why these two are deliberately different values) - and the
                    // concrete aspect-ratio label this render actually used. See
                    // Clip.outputWidth/outputHeight/outputAspectRatio's own schema comment.
                    outputWidth: outputSize.width,
                    outputHeight: outputSize.height,
                    outputAspectRatio: aspectRatioLabel,
                    ...(thumbnailKey ? { thumbnailUrl: thumbnailKey } : {}),
                    ...(thumbnailBlurDataUrl ? { thumbnailBlurDataUrl } : {}),
                    storyboardFrameUrls: storyboardKeys as unknown as Prisma.InputJsonValue,
                    ...(animatedThumbnailKey ? { animatedThumbnailUrl: animatedThumbnailKey } : {}),
                    ...(hoverPreviewKey ? { hoverPreviewUrl: hoverPreviewKey } : {}),
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
                const renderedCount = siblingClips.filter((clip) => clip.outputUrl !== null).length;
                const allDone = renderedCount === siblingClips.length;
                if (allDone) {
                  await tx.video.update({
                    where: { id: videoId },
                    data: { status: VideoStatus.RENDERED },
                  });
                  await tx.videoStatusEvent.create({
                    data: { videoId, toStatus: VideoStatus.RENDERED, errorMessage: null },
                  });
                }
                return { allDone, renderedCount, totalCount: siblingClips.length };
              });
              allRendered = result.allDone;
              renderProgress = {
                renderedCount: result.renderedCount,
                totalCount: result.totalCount,
              };
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

            // Notification Center v2 Phase 2 - the Smart Timeline's per-clip
            // rendering update. Each clip renders as its own independent
            // BullMQ job, so "N of M clips rendered" (computed above, inside
            // the SAME transaction as the clip write, never a separate racy
            // read) is real, already-observable progress - the concrete
            // substrate for "Rendering 15% -> 22% -> 30% updates the same
            // notification, never creates three". allRendered's own terminal
            // RENDERED update (below, after CLIP_READY) supersedes this once
            // every clip is done - both share the exact same threadKey, so
            // recordThreadNotification's upsert-by-threadId always collapses
            // them onto the SAME representative row, never a new one.
            if (!allRendered) {
              await recordThreadNotification(
                prisma,
                {
                  userId: existingClip.video.ownerId,
                  type: 'PIPELINE_PROGRESS',
                  title: existingClip.video.title
                    ? `Memproses "${existingClip.video.title}"`
                    : 'Memproses video Anda',
                  body: `Rendering: ${renderProgress.renderedCount} dari ${renderProgress.totalCount} klip selesai.`,
                  category: NotificationCategory.RENDERING,
                  threadKey: `PIPELINE:${videoId}`,
                  status: 'IN_PROGRESS',
                  videoId,
                  metadata: {
                    renderedClips: renderProgress.renderedCount,
                    totalClips: renderProgress.totalCount,
                  },
                },
                { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
              ).catch((error) => {
                logger.warn(
                  'failed to record pipeline thread notification (rendering progress)',
                  { videoId, clipId },
                  error,
                );
              });
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

            // Notification Center Sprint 4A - Clip Ready. Milestone 04c -
            // deps.publish pushes this over SSE in realtime.
            await recordNotification(
              prisma,
              {
                userId: existingClip.video.ownerId,
                type: 'CLIP_READY',
                title: 'Klip siap!',
                body: existingClip.video.title
                  ? `Klip dari video "${existingClip.video.title}" sudah siap ditonton.`
                  : 'Klip Anda sudah siap ditonton.',
                videoId,
                clipId,
              },
              { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
            ).catch((error) => {
              logger.warn('failed to record CLIP_READY notification', { clipId }, error);
            });

            await triggerAutoPlatformCopy(clipId, existingClip.hookText, processingOptions);
            await triggerAutoPublish(clipId, existingClip.video.ownerId, processingOptions);

            if (allRendered) {
              // Notification Center v2 Phase 2 - this RENDERED transition is
              // inlined above (not updateVideoStatus()) so it joins the same
              // transaction as the last clip's own write, which means it
              // bypasses updateVideoStatus()'s Smart Timeline hook. Calls the
              // exact same presentation table directly (terminal: true, same
              // as updateVideoStatus's own FAILED/RENDERED handling) so the
              // thread reaches its real COMPLETED state - see
              // derivePipelineThreadPresentation()'s own comment. try/catch
              // (not just recordThreadNotification's own .catch()) since
              // derivePipelineThreadPresentation() runs synchronously first -
              // a secondary write's failure must never break the primary job.
              try {
                const presentation = derivePipelineThreadPresentation(VideoStatus.RENDERED, {
                  title: existingClip.video.title,
                });
                await recordThreadNotification(
                  prisma,
                  {
                    userId: existingClip.video.ownerId,
                    type: presentation.type,
                    title: presentation.title,
                    body: presentation.body,
                    category: presentation.category,
                    threadKey: `PIPELINE:${videoId}`,
                    status: presentation.threadStatus,
                    videoId,
                    terminal: true,
                  },
                  { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
                );
              } catch (error) {
                logger.warn(
                  'failed to record pipeline thread notification (RENDERED)',
                  { videoId },
                  error,
                );
              }

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

                // Phase 4 of the thumbnail roadmap (AI Thumbnail Selection,
                // Level 1 - video cover promotion). This is the ONLY place
                // highlightScore/highlightRank are allowed to influence a
                // thumbnail choice - see @speedora/contracts'
                // thumbnail-selection.ts for why that boundary matters. Reuses
                // the winning clip's ALREADY-EXTRACTED thumbnailUrl/
                // thumbnailBlurDataUrl (a plain copy, no re-extraction) -
                // best-effort, same never-fails-the-job posture as ranking
                // itself.
                const coverClipId = ranked.find((clip) => clip.rank === 1)?.clipId;
                if (coverClipId) {
                  const coverClip = await prisma.clip.findUnique({
                    where: { id: coverClipId },
                    select: { thumbnailUrl: true, thumbnailBlurDataUrl: true },
                  });
                  if (coverClip?.thumbnailUrl) {
                    await prisma.video.update({
                      where: { id: videoId },
                      data: {
                        coverClipId,
                        coverThumbnailUrl: coverClip.thumbnailUrl,
                        coverThumbnailBlurDataUrl: coverClip.thumbnailBlurDataUrl,
                      },
                    });
                  }
                }
              } catch (error) {
                logger.warn(
                  'ranking sibling clips failed, continuing without highlightRank',
                  { videoId },
                  error,
                );
              }
            }

            // AI Intelligence v4 Phase 14.2 (Clip Ranking Engine, Stage D
            // wiring - see docs/ai/clip-ranking-engine.md). A SECOND,
            // additive ranking pass beside the highlightRank block above -
            // deliberately OUTSIDE the `if (allRendered)` gate that block
            // sits inside (unlike that name suggests, Fase 31's own ranking
            // only ever runs once, on the single execution that observes
            // allRendered flip true - see its own comment). This pass
            // recomputes after EVERY sibling clip's own render completes,
            // genuinely progressively, naturally converging once the last
            // shortlisted clip lands - same best-effort/never-fails-the-job
            // posture, its OWN try/catch so a failure here can never affect
            // the highlightRank/cover-clip logic above (or vice versa).
            // Scoped to RENDERED siblings only (outputUrl !== null, same
            // query shape as the highlightRank block above, covering both
            // original detect-clips candidates and later "Generate More
            // Clips" top-ups) - an unrendered clip's viralityPrediction/
            // retentionCurveInsights/etc. columns are still null, and
            // ComputeClipRankInput requires several of them as real
            // (non-null) objects, so it can't be meaningfully scored yet; it
            // simply isn't included in this pass until its own render
            // finishes and re-triggers this same block.
            try {
              const renderedSiblings = await prisma.clip.findMany({
                where: { videoId, outputUrl: { not: null } },
                select: {
                  id: true,
                  highlightScore: true,
                  scores: true,
                  hookPrediction: true,
                  narrativeGraph: true,
                  viralityPrediction: true,
                  retentionCurveInsights: true,
                  semanticEvents: true,
                  // Speaker Intelligence Phase D.
                  conversationDynamics: true,
                  conversationType: true,
                },
              });

              // A clip predating this initiative's migrations (or one whose
              // render graph genuinely never produced a real
              // ViralityPrediction/RetentionCurveInsights object - both
              // nodes are optional: false, so that should only happen for
              // pre-migration rows) can't be scored - skipped rather than
              // defaulted, same "don't fabricate data" posture as everywhere
              // else in this codebase. Deliberately does NOT also require
              // conversationDynamics/conversationType (Speaker Intelligence
              // Phase D) - unlike viralityPrediction/retentionCurveInsights,
              // that dimension is nullable in the contract (see
              // ComputeClipRankInput's own doc comment), so a clip predating
              // Phase C's migration still ranks on the other 12 dimensions
              // instead of being excluded from ranking altogether.
              const rankable = renderedSiblings.filter(
                (clip) =>
                  clip.scores !== null &&
                  clip.viralityPrediction !== null &&
                  clip.retentionCurveInsights !== null,
              );

              if (rankable.length > 0) {
                const ranked = rankClipCandidates(
                  rankable.map((clip) => ({
                    clipId: clip.id,
                    highlightScore: clip.highlightScore,
                    scores: clip.scores as unknown as ClipScores,
                    viralityPrediction: clip.viralityPrediction as unknown as ViralityPrediction,
                    hookPrediction: clip.hookPrediction as unknown as HookPredictionOutput | null,
                    narrativeGraph: clip.narrativeGraph as unknown as NarrativeGraph | null,
                    retentionCurveInsights:
                      clip.retentionCurveInsights as unknown as RetentionCurveInsights,
                    semanticEvents: clip.semanticEvents as unknown as SemanticEvent[] | null,
                    conversationDynamics:
                      clip.conversationDynamics as unknown as ConversationDynamics | null,
                    conversationType:
                      clip.conversationType as unknown as ConversationTypeResult | null,
                  })),
                );

                await Promise.all(
                  ranked.map((clip) =>
                    prisma.clip.update({
                      where: { id: clip.clipId },
                      data: {
                        compositeRankScore: clip.compositeScore,
                        compositeRank: clip.rank,
                        compositeRankConfidence: clip.confidence,
                        compositeRankSubScores: clip.subScores as unknown as Prisma.InputJsonValue,
                      },
                    }),
                  ),
                );
              }
            } catch (error) {
              logger.warn(
                'composite clip ranking failed, continuing without compositeRank',
                { videoId },
                error,
              );
            }

            logger.info('clip rendered', { clipId, outputUrl: outputKey });

            return { clipId, outputUrl: outputKey };
          } catch (error) {
            // Reliability hardening pass, same coordination as
            // probe-video.worker.ts/transcribe.worker.ts: an
            // UnrecoverableError is never retryable (none is thrown in this
            // file today - every failure mode here defaults retryable,
            // same "unknown error defaults retryable" convention
            // import-youtube.worker.ts already uses); anything else is
            // gated on whether this is genuinely the last BullMQ attempt.
            const isRetryable = !(error instanceof UnrecoverableError);
            const attemptNumber = job.attemptsMade + 1;
            const maxAttempts = job.opts.attempts ?? 1;
            const isFinalAttempt = !isRetryable || attemptNumber >= maxAttempts;

            logger.error(
              'clip failed',
              { videoId, clipId, attempt: attemptNumber, maxAttempts, willRetry: !isFinalAttempt },
              error,
            );
            // Tags only - never the transcript text or the source video itself.
            Sentry.captureException(error, { tags: { videoId, clipId } });
            const errorMessage = error instanceof Error ? error.message : String(error);

            // A later "Generate More Clips" top-up render can fail on a video
            // that already reached RENDERED once (Phase C backlog item) -
            // that's one clip's own problem, not a regression of the whole
            // video, so it must not stomp Video.status back to FAILED. Doing
            // so would incorrectly reopen/re-terminate the already-closed
            // Smart Timeline thread (updateVideoStatus always calls
            // derivePipelineThreadPresentation, which has no "still fine,
            // just one extra clip failed" case) and would misclassify the
            // video in History/export, both of which read RENDERED as "done".
            // Re-fetched fresh here (not existingClip.video, fetched before
            // the potentially long FFmpeg render above and missing `status`
            // entirely) so this reflects the video's real current state.
            const currentVideo = await prisma.video.findUnique({
              where: { id: videoId },
              select: { status: true, ownerId: true, title: true },
            });
            // Both branches below are gated on isFinalAttempt - firing
            // either one on a non-final attempt would prematurely show the
            // video/clip as failed (or fire a misleading "Coba Lagi" CTA)
            // for something BullMQ is about to retry successfully in the
            // background, even though this worker's own idempotency guard
            // is Clip-level (existingClip.outputUrl) and isn't itself at
            // risk from an early write here.
            if (isFinalAttempt) {
              if (currentVideo?.status === VideoStatus.RENDERED) {
                // Reuses RENDER_FAILED so the existing generic NotificationBell
                // action derivation (deriveActions in notifications-v2.service.ts)
                // attaches the same "Coba Lagi" retry button, wired to the same
                // POST /videos/:id/retry - no frontend change needed.
                await recordNotification(
                  prisma,
                  {
                    userId: currentVideo.ownerId,
                    type: 'RENDER_FAILED',
                    title: 'Klip tambahan gagal dibuat',
                    body: currentVideo.title
                      ? `Satu klip tambahan dari video "${currentVideo.title}" gagal diproses. Silakan coba lagi.`
                      : 'Satu klip tambahan gagal diproses. Silakan coba lagi.',
                    videoId,
                    clipId,
                    metadata: { errorMessage },
                  },
                  { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
                ).catch((notifyError) => {
                  logger.warn(
                    'failed to record top-up RENDER_FAILED notification',
                    { clipId, videoId },
                    notifyError,
                  );
                });
              } else {
                await updateVideoStatus(
                  prisma,
                  videoId,
                  VideoStatus.FAILED,
                  { errorMessage },
                  { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
                );
              }
            }
            throw error;
          } finally {
            if (sourcePath) await cleanupTempFile(sourcePath);
            if (subtitlesPath) await cleanupTempFile(subtitlesPath);
            if (outputPath) await cleanupTempFile(outputPath);
            if (trimmedPath) await cleanupTempFile(trimmedPath);
            if (reactionHoldPath) await cleanupTempFile(reactionHoldPath);
            if (sendCmdPath) await cleanupTempFile(sendCmdPath);
            if (thumbPath) await cleanupTempFile(thumbPath);
            if (blurPath) await cleanupTempFile(blurPath);
            if (animatedThumbnailPath) await cleanupTempFile(animatedThumbnailPath);
            if (hoverPreviewPath) await cleanupTempFile(hoverPreviewPath);
            for (const storyboardPath of storyboardPaths) await cleanupTempFile(storyboardPath);
            for (const brollPath of brollPaths) await cleanupTempFile(brollPath);
            if (watermarkPath) await cleanupTempFile(watermarkPath);
            if (introPath) await cleanupTempFile(introPath);
            if (introConcatPath) await cleanupTempFile(introConcatPath);
            if (outroPath) await cleanupTempFile(outroPath);
            if (outroConcatPath) await cleanupTempFile(outroConcatPath);
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
