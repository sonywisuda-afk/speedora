import type {
  CaptionStyle as PrismaCaptionStyle,
  TranscriptionProvider as PrismaTranscriptionProvider,
  TranscriptSegment as TranscriptSegmentRow,
} from '@speedora/database';
import type {
  AudioFeatures,
  CaptionStyle,
  ClipScores,
  FacialEmotionFeatures,
  FacialEmotionSample,
  FusionBreakdown,
  FusionExplainability,
  FusionPrediction,
  FusionRecommendation,
  GestureFeatures,
  GestureSample,
  SceneFeatures,
  TranscriptionProvider,
  TranscriptSegment,
  TranscriptWord,
} from '@speedora/shared';

// Prisma types a Json column as the opaque JsonValue union - this narrows it
// back to the shape transcribe.worker.ts actually writes there. Used
// wherever a TranscriptSegment row read from Postgres needs to become the
// packages/shared-typed shape a job payload expects (VideosService.retry,
// ClipsService.render).
export function toSharedTranscriptSegment(segment: TranscriptSegmentRow): TranscriptSegment {
  return {
    start: segment.start,
    end: segment.end,
    text: segment.text,
    speaker: segment.speaker ?? undefined,
    emotion: segment.emotion ?? undefined,
    words: Array.isArray(segment.words)
      ? (segment.words as unknown as TranscriptWord[])
      : undefined,
    rmsDb: segment.rmsDb ?? undefined,
    peakDb: segment.peakDb ?? undefined,
    speakingRateWordsPerSecond: segment.speakingRateWordsPerSecond ?? undefined,
  };
}

// Prisma's generated CaptionStyle enum and packages/shared's are two
// separately-declared TS enums with identical string members (see
// CLAUDE.md's "Mirrors X" convention, also used for VideoStatus) - which
// makes them structurally identical at runtime but nominally distinct
// types, so passing one where the other is expected needs this explicit
// (safe) cast rather than a silent compile error.
export function toSharedCaptionStyle(style: PrismaCaptionStyle): CaptionStyle {
  return style as unknown as CaptionStyle;
}

// Same enum-mirroring situation as toSharedCaptionStyle above, for
// Video.transcriptionProvider - used by VideosService.retry() to forward a
// video's stored provider choice back into a re-enqueued transcribe/
// import-youtube job.
export function toSharedTranscriptionProvider(
  provider: PrismaTranscriptionProvider,
): TranscriptionProvider {
  return provider as unknown as TranscriptionProvider;
}

// Same "Json column is opaque" situation as toSharedTranscriptSegment above,
// for Clip.scores (Fase 8's Content Intelligence breakdown) - used wherever
// a Clip row read from Postgres needs to become the packages/shared-typed
// DTO (ClipsService.toDto, VideosService.mapVideoWithClips).
export function toSharedClipScores(scores: unknown): ClipScores | null {
  return (scores as ClipScores | null) ?? null;
}

// Same "Json column is opaque" situation as toSharedClipScores above, for
// Clip.facialEmotions (Fase 27's Facial Intelligence) - used wherever a Clip
// row read from Postgres needs to become the packages/shared-typed DTO
// (ClipsService.toDto, VideosService.mapVideoWithClips).
export function toSharedFacialEmotions(facialEmotions: unknown): FacialEmotionSample[] | null {
  return (facialEmotions as FacialEmotionSample[] | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.audioFeatures/.sceneFeatures/.facialFeatures (Fase 28's Mini Fusion
// Engine v1 prep) - used wherever a Clip row read from Postgres needs to
// become the packages/shared-typed DTO (ClipsService.toDto,
// VideosService.mapVideoWithClips).
export function toSharedAudioFeatures(audioFeatures: unknown): AudioFeatures | null {
  return (audioFeatures as AudioFeatures | null) ?? null;
}

export function toSharedSceneFeatures(sceneFeatures: unknown): SceneFeatures | null {
  return (sceneFeatures as SceneFeatures | null) ?? null;
}

export function toSharedFacialFeatures(facialFeatures: unknown): FacialEmotionFeatures | null {
  return (facialFeatures as FacialEmotionFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as toSharedFacialEmotions above,
// for Clip.gestures (Fase 30's Gesture Intelligence).
export function toSharedGestures(gestures: unknown): GestureSample[] | null {
  return (gestures as GestureSample[] | null) ?? null;
}

export function toSharedGestureFeatures(gestureFeatures: unknown): GestureFeatures | null {
  return (gestureFeatures as GestureFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.highlightBreakdown (Fase 29/31's Mini Fusion Engine v1 -> v2) -
// always populated in practice (computeHighlightScore never returns
// without a contributions array, even an empty one), but narrowed
// defensively the same way regardless. v2's breakdown is an ARRAY of
// per-feature contributions, not an object keyed by signal - `?? []`, not
// `?? {}`.
export function toSharedHighlightBreakdown(highlightBreakdown: unknown): FusionBreakdown {
  return (highlightBreakdown as FusionBreakdown | null) ?? [];
}

export function toSharedHighlightExplainability(
  highlightExplainability: unknown,
): FusionExplainability {
  return (highlightExplainability as FusionExplainability | null) ?? { topFactors: [] };
}

// Same "Json column is opaque" situation as toSharedClipScores above, for
// Clip.llmFeatures (Fase 32 - the same ClipScores shape, echoed back as
// what the Fusion Engine's `llm` signal actually consumed at render time).
export function toSharedLlmFeatures(llmFeatures: unknown): ClipScores | null {
  return (llmFeatures as ClipScores | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.highlightPrediction/.highlightRecommendation (Fase 32's Prediction &
// Recommendation stages).
export function toSharedHighlightPrediction(highlightPrediction: unknown): FusionPrediction | null {
  return (highlightPrediction as FusionPrediction | null) ?? null;
}

export function toSharedHighlightRecommendation(
  highlightRecommendation: unknown,
): FusionRecommendation | null {
  return (highlightRecommendation as FusionRecommendation | null) ?? null;
}
