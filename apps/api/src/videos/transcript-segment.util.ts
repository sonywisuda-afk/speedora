import type {
  CaptionStyle as PrismaCaptionStyle,
  TranscriptionProvider as PrismaTranscriptionProvider,
  TranscriptSegment as TranscriptSegmentRow,
} from '@speedora/database';
import type {
  ActiveSpeakerSample,
  AudioFeatures,
  CameraMotionFeatures,
  CameraMotionSample,
  CaptionStyle,
  ClipScores,
  CompositionFeatures,
  DiarizationFeatures,
  EditingRhythmFeatures,
  FaceLandmarkFeatures,
  FaceLandmarkSample,
  FaceTrackingQualityMetrics,
  FacialEmotionFeatures,
  FacialEmotionSample,
  FusionBreakdown,
  FusionExplainability,
  FusionPrediction,
  FusionRecommendation,
  GestureFeatures,
  GestureSample,
  LipSyncVerification,
  OcrFeatures,
  OcrSample,
  MotionEnergyFeatures,
  MotionEnergySample,
  ObjectFeatures,
  ObjectSample,
  ObjectTrack,
  OcrTextTrack,
  SceneCutEvent,
  SceneFeatures,
  SpeakerConfidenceScore,
  SpeakerEngagementScore,
  SpeakerFaceAssociation,
  SpeakerHighlightMoment,
  SpeakerImportanceScore,
  SpeakerTimelineEntry,
  SpeakerTimelineFeatures,
  TranscriptionProvider,
  TranscriptSegment,
  TranscriptWord,
  VoiceActivityFeatures,
  VoiceActivitySegment,
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

// Same "Json column is opaque" situation as toSharedClipScores above, for
// Video/Clip.storyboardFrameUrls (Phase 3, Hover Preview/Storyboard roadmap).
// Empty array (not null) default - this narrows the RAW storage keys read
// from Postgres; VideosService.mapVideoWithClips/ClipsService.toDto still
// need to convert those into `/videos|clips/:id/storyboard/:index` endpoint
// paths (same "never expose a raw key" treatment as thumbnailUrl), which
// only needs this array's length, not its actual values.
export function toSharedStoryboardFrameKeys(storyboardFrameUrls: unknown): string[] {
  return Array.isArray(storyboardFrameUrls) ? (storyboardFrameUrls as string[]) : [];
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

// Same "Json column is opaque" situation as toSharedFacialEmotions above,
// for Clip.sceneCutEvents (Batch SC-1's Scene Intelligence taxonomy
// expansion).
export function toSharedSceneCutEvents(sceneCutEvents: unknown): SceneCutEvent[] | null {
  return (sceneCutEvents as SceneCutEvent[] | null) ?? null;
}

// Same "Json column is opaque" situation as toSharedSceneFeatures above,
// for Clip.motionEnergyFeatures (Batch SC-2's Scene Intelligence taxonomy
// expansion).
export function toSharedMotionEnergyFeatures(
  motionEnergyFeatures: unknown,
): MotionEnergyFeatures | null {
  return (motionEnergyFeatures as MotionEnergyFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.motionEnergy (Batch SC-2) - unlike facialEmotions/gestures/ocrText,
// this one is never null at the DB level (`Json @default("[]")`,
// analyzeMotionEnergy() never fails the job - see @speedora/scene-
// intelligence's own module comment), so it defaults to an empty array
// rather than null.
export function toSharedMotionEnergy(motionEnergy: unknown): MotionEnergySample[] {
  return (motionEnergy as MotionEnergySample[] | undefined) ?? [];
}

// Same "Json column is opaque" situation as toSharedFacialEmotions above,
// for Clip.cameraMotion (Batch SC-3) - unlike motionEnergy, this one CAN be
// null (a Python/OpenCV subprocess result, same null-vs-empty-array
// convention as facialEmotions/gestures).
export function toSharedCameraMotion(cameraMotion: unknown): CameraMotionSample[] | null {
  return (cameraMotion as CameraMotionSample[] | null) ?? null;
}

export function toSharedCameraMotionFeatures(
  cameraMotionFeatures: unknown,
): CameraMotionFeatures | null {
  return (cameraMotionFeatures as CameraMotionFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.editingRhythmFeatures (taxonomy category F - Editing Rhythm).
export function toSharedEditingRhythmFeatures(
  editingRhythmFeatures: unknown,
): EditingRhythmFeatures | null {
  return (editingRhythmFeatures as EditingRhythmFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.compositionFeatures (Composition Intelligence roadmap).
export function toSharedCompositionFeatures(compositionFeatures: unknown): CompositionFeatures | null {
  return (compositionFeatures as CompositionFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Video.voiceActivitySegments/voiceActivityFeatures (Speaker Intelligence
// roadmap, Milestone A) - the first Video-level (not Clip-level) pair of
// these, see schema.prisma's own comment on why.
export function toSharedVoiceActivitySegments(
  voiceActivitySegments: unknown,
): VoiceActivitySegment[] | null {
  return (voiceActivitySegments as VoiceActivitySegment[] | null) ?? null;
}

export function toSharedVoiceActivityFeatures(
  voiceActivityFeatures: unknown,
): VoiceActivityFeatures | null {
  return (voiceActivityFeatures as VoiceActivityFeatures | null) ?? null;
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

// Same "Json column is opaque" situation as toSharedGestures/
// toSharedGestureFeatures above, for Clip.faceLandmarks/.faceLandmarkFeatures
// (AI Fusion roadmap's Face Intelligence initiative, Batch 1).
export function toSharedFaceLandmarks(faceLandmarks: unknown): FaceLandmarkSample[] | null {
  return (faceLandmarks as FaceLandmarkSample[] | null) ?? null;
}

export function toSharedFaceLandmarkFeatures(
  faceLandmarkFeatures: unknown,
): FaceLandmarkFeatures | null {
  return (faceLandmarkFeatures as FaceLandmarkFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as toSharedFaceLandmarks/
// toSharedFaceLandmarkFeatures above, for Clip.trackingQualityMetrics (AI
// Fusion roadmap's Face Intelligence initiative, Batch 4.5).
export function toSharedTrackingQualityMetrics(
  trackingQualityMetrics: unknown,
): FaceTrackingQualityMetrics | null {
  return (trackingQualityMetrics as FaceTrackingQualityMetrics | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.activeSpeakerSamples/speakerFaceAssociations/lipSyncVerifications
// (Speaker Intelligence roadmap, Milestone A). All three are plain JSON
// arrays (never JsonNull once faceLandmarks succeeds - see schema.prisma's
// own comment), same "null exactly when faceLandmarks is null" convention
// as faceLandmarkFeatures/trackingQualityMetrics above.
export function toSharedActiveSpeakerSamples(
  activeSpeakerSamples: unknown,
): ActiveSpeakerSample[] | null {
  return (activeSpeakerSamples as ActiveSpeakerSample[] | null) ?? null;
}

export function toSharedSpeakerFaceAssociations(
  speakerFaceAssociations: unknown,
): SpeakerFaceAssociation[] | null {
  return (speakerFaceAssociations as SpeakerFaceAssociation[] | null) ?? null;
}

export function toSharedLipSyncVerifications(
  lipSyncVerifications: unknown,
): LipSyncVerification[] | null {
  return (lipSyncVerifications as LipSyncVerification[] | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Video.diarizationFeatures and Clip.speakerTimeline/speakerTimelineFeatures
// (Speaker Intelligence roadmap, Milestone B).
export function toSharedDiarizationFeatures(
  diarizationFeatures: unknown,
): DiarizationFeatures | null {
  return (diarizationFeatures as DiarizationFeatures | null) ?? null;
}

export function toSharedSpeakerTimeline(
  speakerTimeline: unknown,
): SpeakerTimelineEntry[] | null {
  return (speakerTimeline as SpeakerTimelineEntry[] | null) ?? null;
}

export function toSharedSpeakerTimelineFeatures(
  speakerTimelineFeatures: unknown,
): SpeakerTimelineFeatures | null {
  return (speakerTimelineFeatures as SpeakerTimelineFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.speakerConfidenceScores/speakerEngagementScores/
// speakerImportanceScores/speakerHighlightMoments (Speaker Intelligence
// roadmap, Milestone C).
export function toSharedSpeakerConfidenceScores(
  speakerConfidenceScores: unknown,
): SpeakerConfidenceScore[] | null {
  return (speakerConfidenceScores as SpeakerConfidenceScore[] | null) ?? null;
}

export function toSharedSpeakerEngagementScores(
  speakerEngagementScores: unknown,
): SpeakerEngagementScore[] | null {
  return (speakerEngagementScores as SpeakerEngagementScore[] | null) ?? null;
}

export function toSharedSpeakerImportanceScores(
  speakerImportanceScores: unknown,
): SpeakerImportanceScore[] | null {
  return (speakerImportanceScores as SpeakerImportanceScore[] | null) ?? null;
}

export function toSharedSpeakerHighlightMoments(
  speakerHighlightMoments: unknown,
): SpeakerHighlightMoment[] | null {
  return (speakerHighlightMoments as SpeakerHighlightMoment[] | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.ocrText (AI Fusion roadmap's OCR initiative, Batch OCR-1).
export function toSharedOcrText(ocrText: unknown): OcrSample[] | null {
  return (ocrText as OcrSample[] | null) ?? null;
}

// Same "Json column is opaque" situation as toSharedOcrText above, for
// Clip.ocrTracks/.ocrFeatures (Batch OCR-2).
export function toSharedOcrTracks(ocrTracks: unknown): OcrTextTrack[] | null {
  return (ocrTracks as OcrTextTrack[] | null) ?? null;
}

export function toSharedOcrFeatures(ocrFeatures: unknown): OcrFeatures | null {
  return (ocrFeatures as OcrFeatures | null) ?? null;
}

// Same "Json column is opaque" situation as the functions above, for
// Clip.objects/.objectTracks/.objectFeatures (Object Intelligence roadmap,
// Batch OI-1).
export function toSharedObjects(objects: unknown): ObjectSample[] | null {
  return (objects as ObjectSample[] | null) ?? null;
}

export function toSharedObjectTracks(objectTracks: unknown): ObjectTrack[] | null {
  return (objectTracks as ObjectTrack[] | null) ?? null;
}

export function toSharedObjectFeatures(objectFeatures: unknown): ObjectFeatures | null {
  return (objectFeatures as ObjectFeatures | null) ?? null;
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
