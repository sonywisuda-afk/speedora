import type { ProcessingOptions } from './processing-options';
import type { PublishRecord } from './social';

export enum VideoStatus {
  // Only reachable via POST /videos/import-youtube - a direct file upload
  // (POST /videos) goes straight to UPLOADED since the file is already in
  // hand. IMPORTING covers the time apps/worker's import-youtube job spends
  // downloading the source video before it has a real sourceUrl to store.
  IMPORTING = 'IMPORTING',
  UPLOADED = 'UPLOADED',
  // Quality Validation roadmap (Fase 0 design, Phase 1) - reached once
  // probe-video.worker.ts's ffprobe pass succeeds (see schema.prisma's own
  // comment on this value for the full lifecycle). While a probe is still
  // running the status stays UPLOADED - the frontend distinguishes "still
  // probing" from "ready for a real transcribe pass" by whether width/
  // height are populated yet (see apps/web/app/upload/page.tsx), the same
  // "one coarse status, a data field as the real sub-state signal"
  // convention importProgress/transcribeProgress already use.
  PENDING_SETTINGS = 'PENDING_SETTINGS',
  TRANSCRIBED = 'TRANSCRIBED',
  CLIPS_DETECTED = 'CLIPS_DETECTED',
  RENDERED = 'RENDERED',
  FAILED = 'FAILED',
}

// Quality Validation roadmap (Fase 0 design, Phase 2) - mirrors
// @speedora/contracts' ValidationFinding/ValidationReport rather than
// importing them - same duplication precedent as ClipScores/
// FacialEmotionSample above. errors is always [] (Error-tier is a hard
// probe-video.worker.ts failure, never reaches this field at all - see
// ValidationReport's own comment in @speedora/contracts); info is always []
// in Phase 2 (a separate cost/time estimate feature, not duplicated here).
export interface ValidationFinding {
  id: string;
  message: string;
}

export interface ValidationReport {
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  info: ValidationFinding[];
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  // Subtitle Studio roadmap (P2) - the DB row's own stable cuid, needed to
  // address a specific segment for edit/merge/split. Optional (not every
  // TranscriptSegment-shaped object in this codebase is a real DB row - job
  // payloads/pre-insert Whisper output construct this shape too) - always
  // populated by toSharedTranscriptSegment for a real row.
  id?: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  // Top-1 label from a vocal (audio-based) emotion classifier - one of
  // "neu"/"hap"/"ang"/"sad" (see CLAUDE.md's "Vocal Emotion Detection"
  // section). Undefined for segments too short to classify, or when
  // detection wasn't run/failed for this video - same optional-signal
  // treatment as speaker above.
  emotion?: string;
  // Word-level timestamps from Whisper - undefined for segments transcribed
  // before this field existed (Fase 3 pasca-MVP, not backfilled). Only the
  // karaoke caption preset needs this; render-clip falls back to plain text
  // for a segment that lacks it rather than failing.
  words?: TranscriptWord[];
  // Fase 25 (Audio Intelligence, AI Fusion roadmap Phase A) - this
  // segment's own mean RMS/peak level in dB (see
  // @speedora/audio-intelligence). Undefined for segments transcribed
  // before this field existed, or when analysis wasn't run/failed - same
  // optional-signal treatment as emotion above. Not calibrated/comparable
  // across different source recordings, only relative within one video.
  rmsDb?: number;
  peakDb?: number;
  // Words per second within this segment - pure math from start/end/word
  // count, always present once a segment has word-level data (undefined
  // only alongside a missing `words`).
  speakingRateWordsPerSecond?: number;
  // Subtitle Studio roadmap (P2f) - sparse languageCode -> translated text
  // map, populated one language at a time via the new translate endpoint.
  // Undefined until at least one language has been requested for this
  // segment.
  translations?: Record<string, string>;
}

// Mirrors CaptionStyle in packages/database's Prisma schema.
export enum CaptionStyle {
  DEFAULT = 'DEFAULT',
  KARAOKE = 'KARAOKE',
  BOLD_HIGHLIGHT = 'BOLD_HIGHLIGHT',
}

export const CAPTION_STYLES: CaptionStyle[] = [
  CaptionStyle.DEFAULT,
  CaptionStyle.KARAOKE,
  CaptionStyle.BOLD_HIGHLIGHT,
];

// Mirrors TranscriptionProvider in packages/database's Prisma schema. Chosen
// once per video at upload/import time (see CLAUDE.md's Premium
// Transcription section) - GROQ (Whisper large-v3-turbo) is the free
// default; OPENAI (Whisper-1) is the paid "premium" tier, gated by a
// PremiumCredit (see payment.ts).
export enum TranscriptionProvider {
  GROQ = 'GROQ',
  OPENAI = 'OPENAI',
}

// Multi-metric breakdown behind the single viralityScore, from the same
// detect-clips LLM call (see CLAUDE.md's Fase 8 "Content Intelligence"
// section, extended Fase 32) - each 0-100. Explicitly a heuristic LLM
// estimate, not a statistically trained/calibrated prediction - there is
// no engagement dataset behind these numbers. Grouped into four domains
// (see @speedora/contracts' SCORE_DOMAINS) - Engagement: hookStrength/
// curiosity/emotion/storytelling; Knowledge: educationalValue/
// practicalValue/novelty/trustAuthority; Conversion: ctaStrength.
export interface ClipScores {
  hookStrength: number;
  educationalValue: number;
  // Fase 32 - how much a viewer could immediately apply this clip's
  // information with minimal additional knowledge (see
  // @speedora/clip-scoring's prompt for the full scoring criteria).
  practicalValue: number;
  curiosity: number;
  emotion: number;
  storytelling: number;
  novelty: number;
  trustAuthority: number;
  // Fase 32 - how persuasive the clip's call-to-action is, 0 if none.
  ctaStrength: number;
}

// Fase 27 (Facial Intelligence, AI Fusion roadmap Phase C) - one sampled
// frame's classified facial expression, clip-relative seconds. Mirrors
// @speedora/contracts' FacialEmotionSample shape rather than importing it -
// same duplication precedent as ClipScores above (packages/shared doesn't
// take a dependency on @speedora/contracts just for one small type). null
// emotion/score means no face was found in that sampled frame, not an
// error - see @speedora/facial-intelligence's own module comment.
export interface FacialEmotionSample {
  t: number;
  emotion: string | null;
  score: number | null;
}

// Fase 30 (Gesture Intelligence, AI Fusion roadmap Checkpoint 2) - one
// sampled frame's classified hand gesture, clip-relative seconds. Mirrors
// @speedora/contracts' GestureSample shape rather than importing it - same
// duplication precedent as FacialEmotionSample above. null gesture/
// confidence means no hand was detected at all (distinct from "none", a
// hand detected but no recognized gesture) - see
// @speedora/gesture-intelligence's own module comment.
export interface GestureSample {
  t: number;
  gesture: string | null;
  confidence: number | null;
}

// Fase 28 (Mini Fusion Engine v1 prep, AI Fusion roadmap Checkpoint 1) -
// dense derived summaries the Fusion Engine consumes, one per signal
// module (see packages/contracts/src/intelligence-signal.ts's raw/features
// convention and packages/contracts/src/fusion.ts's input contract).
// Mirrors each module's own contracts/ Features shape rather than
// importing it - same duplication precedent as ClipScores/
// FacialEmotionSample above.
export interface AudioFeatures {
  averageRmsDb: number | null;
  peakDb: number | null;
  averageSpeakingRateWordsPerSecond: number | null;
  speakingRateStdDev: number | null;
}

export interface SceneFeatures {
  cutCount: number;
  cutsPerMinute: number | null;
  averageSegmentSeconds: number | null;
  // Batch SC-1 (Scene Intelligence taxonomy expansion) - breakdown of
  // cutCount by type, see SceneCutType below. dissolveCount is always 0 for
  // now (dissolve isn't detected yet).
  hardCutCount: number;
  fadeCount: number;
  dissolveCount: number;
}

// Batch SC-1 (Scene Intelligence taxonomy expansion, on top of Fase 26) -
// mirrors @speedora/contracts' SCENE_CUT_TYPES/SceneCutEvent shape rather
// than importing it, same duplication precedent as FacialEmotionSample/
// GestureSample above. 'dissolve' is reserved (part of the taxonomy) but
// never actually produced by this batch - see the contracts module's own
// comment.
export const SCENE_CUT_TYPES = ['hard_cut', 'fade', 'dissolve'] as const;
export type SceneCutType = (typeof SCENE_CUT_TYPES)[number];

export interface SceneCutEvent {
  t: number;
  type: SceneCutType;
}

// Batch SC-2 (Scene Intelligence taxonomy expansion, continuing Batch SC-1) -
// mirrors @speedora/contracts' MotionEnergySample shape rather than
// importing it, same duplication precedent as SceneCutEvent above. A
// SEPARATE signal from cut classification (motion magnitude, not cut
// events) - see @speedora/scene-intelligence's analyzeMotionEnergy module
// comment.
export interface MotionEnergySample {
  t: number;
  motionEnergy: number;
}

export interface MotionEnergyFeatures {
  averageMotionEnergy: number | null;
  peakMotionEnergy: number | null;
  staticRatio: number | null;
  dynamicRatio: number | null;
  // Batch SC-5 (Scene Intelligence taxonomy expansion) - Motion Peak
  // Detection.
  peakCount: number | null;
  peakTimestamps: number[] | null;
  peakRatePerMinute: number | null;
  // Batch SC-6 (Scene Intelligence taxonomy expansion) - Motion Complexity
  // (motion-energy half).
  motionVariability: number | null;
}

// Batch SC-3 (Scene Intelligence taxonomy expansion, continuing SC-1/SC-2) -
// mirrors @speedora/contracts' CameraMotionSample shape rather than
// importing it, same duplication precedent as MotionEnergySample above. A
// SEPARATE signal from motionEnergy (directional pan/tilt/zoom/rotation, not
// undirected magnitude) - see @speedora/scene-intelligence's
// detectCameraMotion module comment.
export interface CameraMotionSample {
  t: number;
  dx: number | null;
  dy: number | null;
  scale: number | null;
  rotation: number | null;
  ecc: number | null;
}

export const CAMERA_MOTION_TYPES = ['pan', 'tilt', 'zoom', 'shake', 'static'] as const;
export type CameraMotionType = (typeof CAMERA_MOTION_TYPES)[number];

// Batch SC-4 (Scene Intelligence taxonomy expansion) - mirrors
// @speedora/contracts' CameraMotionDirectionType, same duplication
// precedent as CameraMotionType above.
export const CAMERA_MOTION_DIRECTION_TYPES = [
  'left',
  'right',
  'up',
  'down',
  'in',
  'out',
  'static',
] as const;
export type CameraMotionDirectionType = (typeof CAMERA_MOTION_DIRECTION_TYPES)[number];

export interface CameraMotionFeatures {
  panScore: number | null;
  tiltScore: number | null;
  zoomScore: number | null;
  shakeScore: number | null;
  dominantMotionType: CameraMotionType | null;
  // Batch SC-4 - descriptive/explainability only, not fed into the Fusion
  // Engine (see @speedora/fusion-engine's extractCameraMotionFeatures).
  dominantDirection: CameraMotionDirectionType | null;
  // Batch SC-6 - Motion Complexity (camera-motion half).
  motionTypeDiversity: number | null;
  // Batch SC-7 - Motion Smoothness (Camera Jitter).
  smoothnessScore: number | null;
}

// Taxonomy category F (Editing Rhythm, requested by user after Scene
// Intelligence Batch SC-3) - mirrors @speedora/contracts'
// EditingRhythmFeatures shape rather than importing it, same duplication
// precedent as CameraMotionSample above. A COMPOSITE signal (its own
// module combines OTHER signals' already-computed output), not a raw
// detector - see @speedora/editing-rhythm's own module comment.
export interface EditingRhythmFeatures {
  tempoScore: number | null;
  pacingScore: number | null;
  accelerationScore: number | null;
}

// Composition Intelligence roadmap (rule of thirds, headroom, lead room,
// centering, composition stability, framing consistency, subject loss
// ratio) - mirrors @speedora/contracts' CompositionFeatures shape rather
// than importing it, same duplication precedent as CameraMotionSample/
// EditingRhythmFeatures above. A COMPOSITE signal (its input is OTHER
// modules' already-computed bounding boxes via the standalone
// @speedora/primary-subject package, not a fresh detector) - see
// @speedora/composition-intelligence's own module comment. All fields null
// when there were zero usable primary-subject samples for this clip, same
// nullability convention as EditingRhythmFeatures' constituent scores.
export interface CompositionFeatures {
  ruleOfThirdsScore: number | null;
  headroomScore: number | null;
  leadRoomScore: number | null;
  centeringScore: number | null;
  subjectLossRatio: number | null;
  compositionStability: number | null;
  framingConsistency: number | null;
}

// Phase 4 of the thumbnail roadmap (AI Thumbnail Selection, Level 2 - frame/
// timestamp selection within an already-chosen clip, never which clip is
// the video's cover) - mirrors @speedora/contracts' thumbnail-selection.ts
// shapes rather than importing them, same duplication precedent as
// CompositionFeatures/EditingRhythmFeatures above.
export const THUMBNAIL_SIGNALS = [
  'faceClarity',
  'emotion',
  'ocrImportance',
  'gesture',
  'motion',
  'composition',
] as const;
export type ThumbnailSignal = (typeof THUMBNAIL_SIGNALS)[number];

export interface ThumbnailContribution {
  signal: ThumbnailSignal;
  rawValue: number | null;
  normalizedValue: number;
  weight: number;
  weightedContribution: number;
}

export const THUMBNAIL_FALLBACK_LEVELS = ['midpoint', 'single_signal', 'multi_signal'] as const;
export type ThumbnailFallbackLevel = (typeof THUMBNAIL_FALLBACK_LEVELS)[number];

// Speaker Intelligence roadmap, Milestone A (Voice Activity Detection) -
// mirrors @speedora/contracts' VoiceActivitySegment/VoiceActivityFeatures
// shapes rather than importing them, same duplication precedent as
// CameraMotionSample/EditingRhythmFeatures above. Stored on Video (not
// Clip) - see schema.prisma's Video.voiceActivitySegments comment for why.
export const VOICE_ACTIVITY_CATEGORIES = [
  'speech',
  'non_speech',
  'silence',
  'noise',
  'music',
  'crowd',
] as const;
export type VoiceActivityCategory = (typeof VOICE_ACTIVITY_CATEGORIES)[number];

export interface VoiceActivitySegment {
  start: number;
  end: number;
  category: VoiceActivityCategory;
  confidence: number | null;
}

export interface VoiceActivityFeatures {
  speechRatio: number | null;
  silenceRatio: number | null;
  silenceSegmentCount: number | null;
  longestSilenceSeconds: number | null;
}

export interface FacialEmotionFeatures {
  dominantEmotion: string | null;
  emotionTransitions: number;
  peakConfidence: number | null;
  stability: number | null;
}

export interface GestureFeatures {
  dominantGesture: string | null;
  gestureTransitions: number;
  peakConfidence: number | null;
  stability: number | null;
}

// AI Fusion roadmap's Face Intelligence initiative, Batch 1 - one sampled
// frame's MediaPipe FaceLandmarker output (blendshapes/head-rotation/
// framing/iris+eye-corner points), clip-relative seconds. Mirrors
// @speedora/contracts' FaceLandmarkSample shape rather than importing it -
// same duplication precedent as FacialEmotionSample/GestureSample above.
// Every field null means no face was found in that sampled frame.
export interface FaceBlendshapes {
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  mouthSmileLeft: number;
  mouthSmileRight: number;
  jawOpen: number;
  // Batch 5B (Smile & Laugh) - Duchenne-smile markers (orbicularis oculi
  // activation), see @speedora/contracts' faceBlendshapesSchema.
  cheekSquintLeft: number;
  cheekSquintRight: number;
  eyeSquintLeft: number;
  eyeSquintRight: number;
  // Batch 5D (Emotion Heuristic) - eyebrow movement, tracked as an
  // undirected magnitude (see @speedora/contracts' faceBlendshapesSchema).
  browDownLeft: number;
  browDownRight: number;
  browInnerUp: number;
  browOuterUpLeft: number;
  browOuterUpRight: number;
}

export interface FaceRotation {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface NormalizedPoint3d {
  x: number;
  y: number;
  z: number;
}

export interface FaceLandmarkSample {
  t: number;
  blendshapes: FaceBlendshapes | null;
  rotation: FaceRotation | null;
  boundingBox: { xCenter: number; yCenter: number; width: number; height: number } | null;
  leftIris: NormalizedPoint3d | null;
  rightIris: NormalizedPoint3d | null;
  leftEyeInnerCorner: NormalizedPoint3d | null;
  leftEyeOuterCorner: NormalizedPoint3d | null;
  rightEyeInnerCorner: NormalizedPoint3d | null;
  rightEyeOuterCorner: NormalizedPoint3d | null;
  // Batch 3 (Blur/Sharpness/Lighting/Occlusion) - raw Laplacian variance
  // (sharpness), 0-255 mean grayscale (brightness), and the mouth-region-
  // vs-whole-face variance ratio used to derive occlusionRate. See
  // @speedora/facial-intelligence's deriveFaceLandmarkFeatures for the
  // honest caveat on mouthContrastRatio specifically.
  sharpness: number | null;
  brightness: number | null;
  mouthContrastRatio: number | null;
  // Batch 4 (Face Re-identification/Tracking) - a 9-element scale-invariant
  // geometric fingerprint and the single-object tracker's assigned track id
  // (Kalman Filter + Hungarian Assignment + IoU + pose consistency). See
  // @speedora/contracts' faceLandmarkSampleSchema for the full rationale.
  faceDescriptor: number[] | null;
  trackId: number | null;
  // Batch 5B (Smile & Laugh) - scale-invariant mouth-width ratio, see
  // @speedora/contracts' faceLandmarkSampleSchema.
  mouthWidth: number | null;
}

// AI Fusion roadmap's OCR initiative, Batch OCR-1 - one detected on-screen
// text region (Tesseract's own line-level grouping). Mirrors
// @speedora/contracts' ocrTextBlockSchema shape rather than importing it,
// same duplication precedent as FaceLandmarkSample above.
export interface OcrTextBlock {
  text: string;
  boundingBox: { xCenter: number; yCenter: number; width: number; height: number };
  confidence: number;
}

// A sampled frame's worth of OCR output - textBlocks is an EMPTY array
// (not null) when no text was found, since that's an entirely ordinary
// result (most frames have no on-screen text at all), not a detection
// failure - see @speedora/contracts' ocrSampleSchema for the full
// rationale.
export interface OcrSample {
  t: number;
  textBlocks: OcrTextBlock[];
}

// AI Fusion roadmap's OCR initiative, Batch OCR-2 - the 6 SAFE
// classification categories (never a discrete claim like "this is an ad"),
// see @speedora/contracts' OCR_TEXT_CATEGORIES for the full rationale.
export type OcrTextCategory = 'subtitle' | 'slide' | 'caption' | 'logo' | 'price' | 'name';

// Content-pattern evidence used by the rule-fusion classifier - mirrors
// @speedora/contracts' ocrRegexFlagsSchema.
export interface OcrRegexFlags {
  isPriceLike: boolean;
  isNameLike: boolean;
}

// One tracked on-screen text element across its full lifetime in the clip
// - mirrors @speedora/contracts' ocrTextTrackSchema rather than importing
// it, same duplication precedent as FaceLandmarkSample above.
export interface OcrTextTrack {
  trackId: number;
  text: string;
  boundingBox: { xCenter: number; yCenter: number; width: number; height: number };
  confidence: number;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  appearsFrames: number;
  persistenceScore: number;
  motionScore: number | null;
  nearFace: boolean | null;
  language: string | null;
  regexFlags: OcrRegexFlags;
  category: OcrTextCategory;
  categoryConfidence: number;
  classificationMethod: 'HybridRuleEngine';
}

// Aggregate, Fusion-Engine-ready summary derived from OcrTextTrack[] above
// - mirrors @speedora/contracts' ocrFeaturesSchema.
export interface OcrFeatures {
  subtitleCoverageRate: number | null;
  slidePresenceRate: number | null;
  captionRate: number | null;
  logoPresenceRate: number | null;
  priceMentionRate: number | null;
  nameMentionRate: number | null;
  dominantTextCategory: OcrTextCategory | null;
  averageTextBlockCount: number | null;
}

// Object Intelligence roadmap, Batch OI-1 - one detected entity within a
// single sampled frame (MediaPipe Object Detector/EfficientDet-Lite0,
// COCO 80-class). Mirrors @speedora/contracts' objectDetectionSchema shape
// rather than importing it, same duplication precedent as OcrTextBlock
// above. `category` is a plain string (not a union), same reasoning as the
// contract's own comment - COCO's label set is an externally-fixed model
// vocabulary, not a small taxonomy this codebase designed.
export interface ObjectDetection {
  category: string;
  boundingBox: { xCenter: number; yCenter: number; width: number; height: number };
  confidence: number;
}

// A sampled frame's worth of object detections - `objects` is an EMPTY
// array (not null) when nothing was found, same "empty is a real result"
// convention as OcrSample.textBlocks.
export interface ObjectSample {
  t: number;
  objects: ObjectDetection[];
}

// One tracked object across its full lifetime in the clip - mirrors
// @speedora/contracts' objectTrackSchema rather than importing it, same
// duplication precedent as OcrTextTrack above.
export interface ObjectTrack {
  trackId: number;
  category: string;
  boundingBox: { xCenter: number; yCenter: number; width: number; height: number };
  confidence: number;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  appearsFrames: number;
  persistenceScore: number;
  // Batch OI-2 - "objectMotionSpeed"/"objectMotionDirection" from the
  // user's original taxonomy. motionDirection reuses CameraMotionDirectionType
  // directly (see @speedora/contracts' objectTrackSchema comment for why) -
  // a shrinking/growing bounding box is this track's analog of camera zoom
  // in/out. Both null when this track only appeared in a single frame.
  motionSpeed: number | null;
  motionDirection: CameraMotionDirectionType | null;
  // Batch OI-3 - "objectOcclusion" from the user's original taxonomy.
  // Average, across this track's own appearances, of the highest IoU
  // against any other simultaneous detection in the same frame - an honest
  // proxy for occlusion, not a real depth/z-order signal. Never null.
  occlusionScore: number;
  // Batch OI-4 - "objectInteraction" from the user's original taxonomy,
  // exposed as `interactionConfidence` (not a bare score/boolean) since
  // this pipeline has no depth/pose/action recognition and cannot determine
  // real interaction - an unweighted mean of proximity, temporal
  // co-presence, and distance trend (see @speedora/contracts'
  // objectTrackSchema comment for the full breakdown). Never null.
  interactionConfidence: number;
  // Batch OI-5 - "objectAttentionScore" from the user's original taxonomy.
  // A "domain of domains" composite - Visibility (confidence + persistence +
  // inverse occlusion), Activity (motionSpeed + motionPersistence +
  // directionConsistency, 0.5 neutral when no motion data), and Social
  // (interactionConfidence + partnerScore + coPresence), then averaged
  // together - see @speedora/contracts' objectTrackSchema comment for the
  // full architecture. Never null.
  attentionScore: number;
  // Batch OI-5 - a SEPARATE reliability signal for attentionScore, not a
  // sixth ingredient inside it. Based on appearsFrames (capped) - a track
  // backed by very little observation gets a low attentionConfidence even
  // if its attentionScore itself reads high. Never null.
  attentionConfidence: number;
}

// Aggregate, Fusion-Engine-ready summary derived from ObjectTrack[] above -
// mirrors @speedora/contracts' objectFeaturesSchema.
export interface ObjectFeatures {
  objectCount: number | null;
  dominantObject: string | null;
  averageObjectsPerFrame: number | null;
  averageTrackingConfidence: number | null;
  averagePersistence: number | null;
  // Batch OI-2 - mean motionSpeed across tracks that have a computable value.
  averageMotionSpeed: number | null;
  // Batch OI-3 - mean occlusionScore across all tracks.
  averageOcclusionScore: number | null;
  // Batch OI-4 - mean interactionConfidence across all tracks.
  averageInteractionConfidence: number | null;
  // Batch OI-5 - mean attentionScore/attentionConfidence across all tracks.
  averageAttentionScore: number | null;
  averageAttentionConfidence: number | null;
}

// AI Intelligence v4, Phase 1 (Hook Prediction Engine - see docs/ai/
// intelligence-v4.md). Mirrors @speedora/contracts' hookLinguisticFeaturesSchema/
// hookPredictionOutputSchema rather than importing them - same duplication
// precedent as LookingDirection/AffectLabel above (packages/shared and
// packages/contracts are deliberately separate layers - see ARCHITECTURE.md).
export type HookSentiment = 'positive' | 'negative' | 'neutral' | 'mixed';

export interface HookLinguisticFeatures {
  sentiment: HookSentiment;
  dominantEmotion: string;
  surpriseScore: number;
  controversyScore: number;
  keywordRarityScore: number;
  topicShiftScore: number;
  questionDensity: number;
  numericFactCount: number;
  namedEntities: string[];
}

// Every numeric field below is a documented HEURISTIC, not a trained/
// calibrated prediction ("scale honesty" - docs/coding-standards.md).
// Production has 0 usable engagement samples to validate any of this
// against yet, same blocker Fusion Engine v3 has.
export interface HookPredictionOutput {
  clipId: string;
  hookProbability: number;
  reason: string;
  confidence: number;
  linguisticFeatures: HookLinguisticFeatures;
  predictionFeatures: {
    expectedScrollStopRate: number;
    expectedRetentionLift: number;
    expectedReplayPotential: number;
  };
}

// AI Intelligence v4, Phase 2 (Semantic Event Detection - see docs/ai/
// intelligence-v4.md). Mirrors @speedora/contracts' groundedFactSchema/
// semanticEventSchema rather than importing them - same duplication
// precedent as HookLinguisticFeatures/HookPredictionOutput above.
export type GroundedFactSource = 'ocr' | 'object';

export interface GroundedFact {
  source: GroundedFactSource;
  text: string;
  t: number;
}

// The exact 22-value taxonomy from packages/contracts' SEMANTIC_EVENT_TYPES -
// kept as a plain union (not re-derived) since packages/shared doesn't
// import packages/contracts (see ARCHITECTURE.md's layer separation).
export type SemanticEventType =
  | 'confession'
  | 'mistake'
  | 'failure'
  | 'success'
  | 'secret'
  | 'warning'
  | 'prediction'
  | 'tutorial'
  | 'breaking_news'
  | 'conflict'
  | 'lawsuit'
  | 'money'
  | 'ai'
  | 'business'
  | 'career'
  | 'health'
  | 'fear'
  | 'urgency'
  | 'controversy'
  | 'achievement'
  | 'transformation'
  | 'life_lesson';

// Every numeric field below is a documented HEURISTIC, same "scale
// honesty" caveat as HookPredictionOutput above - no engagement data
// exists yet to calibrate confidence/importance against.
export interface SemanticEvent {
  type: SemanticEventType;
  t: number;
  confidence: number;
  importance: number;
  evidence: GroundedFact[];
  reason: string;
}

// AI Intelligence v4, Phase 3 (Narrative Graph - see docs/ai/
// intelligence-v4.md). Mirrors @speedora/contracts' narrativeSegmentSchema/
// narrativeRelationSchema/narrativeGraphSchema rather than importing them -
// same duplication precedent as SemanticEvent/HookPredictionOutput above.
export type NarrativeSegmentType =
  | 'hook'
  | 'setup'
  | 'context'
  | 'problem'
  | 'conflict'
  | 'escalation'
  | 'peak'
  | 'resolution'
  | 'takeaway'
  | 'cta';

// Every numeric field below is a documented HEURISTIC, same "scale
// honesty" caveat as SemanticEvent above.
export interface NarrativeSegment {
  id: number;
  type: NarrativeSegmentType;
  startTime: number;
  endTime: number;
  confidence: number;
  reason: string;
}

// `resolves` edges may connect NON-ADJACENT segments - the concrete thing
// that makes this a graph, not a sliding window (see
// @speedora/contracts' narrative-graph.ts for the full reasoning).
export type NarrativeRelationType = 'leads_to' | 'resolves';

export interface NarrativeRelation {
  fromSegmentId: number;
  toSegmentId: number;
  type: NarrativeRelationType;
}

// `unsegmented: true` (segments/relations both empty) is a REAL,
// SUCCESSFUL result - the clip genuinely doesn't decompose into this
// taxonomy - not a failure. See @speedora/contracts' narrativeGraphSchema
// doc comment for the full reasoning (this phase's required risk
// mitigation: never force a graph onto content that doesn't have one).
export interface NarrativeGraph {
  segments: NarrativeSegment[];
  relations: NarrativeRelation[];
  unsegmented: boolean;
}

// AI Intelligence v4, Phase 4 (Contextual Momentum - see docs/ai/
// intelligence-v4.md). Mirrors @speedora/contracts' momentumSampleSchema
// rather than importing it - same duplication precedent as
// NarrativeGraph/SemanticEvent/HookPredictionOutput above. A per-instant
// timeline (array), not a single per-clip object - same convention as
// motionEnergy/semanticEvents.
export interface MomentumSample {
  t: number;
  // 0-1, RELATIVE within this clip's own samples only - not comparable
  // across clips (same caveat as the raw motionEnergy/cameraMotion
  // signals it's built from). A documented HEURISTIC, same "scale
  // honesty" caveat as every other v4 numeric field.
  momentumScore: number;
}

export type MomentumCurve = MomentumSample[];

// AI Intelligence v4, Phase 5 (Emotional Arc - see docs/ai/
// intelligence-v4.md). Mirrors @speedora/contracts' VOCAL_EMOTIONS - the
// model's own 4-class IEMOCAP taxonomy (superb/wav2vec2-base-superb-er),
// NOT expanded to full words, same "validate real data, not a prettified
// guess" reasoning as the contract itself.
export type VocalEmotion = 'neu' | 'hap' | 'ang' | 'sad';

// Mirrors @speedora/contracts' emotionalArcSampleSchema rather than
// importing it - same duplication precedent as MomentumSample above. One
// sample per transcript segment (not resampled onto a fixed grid) - the
// vocal-emotion half of spec Part 5 (Retention Curve Prediction), pairing
// with Phase 4's MomentumCurve (the visual/structural half).
export interface EmotionalArcSample {
  t: number;
  // null when the segment has no (or an unrecognized) classification - a
  // real, distinct state from a low-intensity 'neu' result.
  emotion: VocalEmotion | null;
  // 0-1, RELATIVE within this clip's own samples only - not comparable
  // across clips. A documented HEURISTIC (ADR D4), same "scale honesty"
  // caveat as every other v4 numeric field - the underlying classifier is
  // itself trained on IEMOCAP's *acted*, not natural, speech.
  intensity: number;
}

export type EmotionalArc = EmotionalArcSample[];

// AI Intelligence v4, Phase 6 (Multi-speaker Reasoning - see docs/ai/
// intelligence-v4.md). Mirrors @speedora/contracts' speakerAttributionSchema
// rather than importing it - same duplication precedent as EmotionalArcSample
// above. One entry per distinct speaker with any turn in the clip (not a
// per-instant timeline) - a post-hoc attribution of Phase 4's MomentumCurve
// and Phase 5's EmotionalArc to whichever speaker was talking, via Speaker
// Intelligence's SpeakerTimelineEntry[].
export interface SpeakerAttribution {
  // SpeakerTimelineEntry's own label ("Speaker A", "Speaker B", ...).
  speaker: string;
  // 0-1 - this speaker's share of the clip's total speaking time.
  talkTimeRatio: number;
  // 0-1 - this speaker's share of the opening hook window's speaking time
  // (Phase 1 tie-in).
  hookWindowTalkTimeRatio: number;
  // 0-1, RELATIVE within this clip's own samples only (Phase 4 tie-in).
  // Null when this speaker has zero overlapping momentum samples.
  averageMomentumScore: number | null;
  peakMomentumScore: number | null;
  // The model's own 4-class label (Phase 5 tie-in) - the most frequent
  // non-null emotion among this speaker's overlapping samples. Null when
  // this speaker has zero overlapping classified samples.
  dominantEmotion: VocalEmotion | null;
  averageEmotionalIntensity: number | null;
}

// Null for the majority single-speaker case (see the module's own doc
// comment) - a genuinely different null-meaning than Phase 4/5's "predates
// migration" null; it's this field's own correct, honest "not applicable"
// result. A present array (length >= 2, sorted by talkTimeRatio descending)
// means the clip genuinely has multiple speakers and was attributed
// successfully.
export type MultiSpeakerBreakdown = SpeakerAttribution[];

// AI Intelligence v4, Phase 7 (Cross-module Fusion, spec Part 4 - Virality
// Engine - see docs/ai/intelligence-v4.md), REALIGNED in Phase 9 once the
// real Part 4 spec text became available (ADR D12) - the shape below is
// the spec's own 7 named probabilities, replacing Phase 7's original 8
// reverse-engineered structural sub-probabilities. Mirrors
// @speedora/contracts' viralitySubProbabilitiesSchema rather than
// importing it - same duplication precedent as SpeakerAttribution above.
// Each field is re-composed from Phases 1/3/4/5's own already-computed
// outputs (no new detector) - null (not 0) when its source data is
// genuinely unavailable.
//
// DELIBERATELY DISTINCT from the pre-existing Clip.viralityScore (Fase 8's
// original MVP LLM clip-scoring, a single 0-100 number used to SELECT
// candidate moments before render) - see docs/ai/scoring.md, which
// documents this as the 4th of 4 distinct scoring systems in this
// codebase; do not conflate the two.
export interface ViralitySubProbabilities {
  scrollStopProbability: number | null;
  watchProbability: number | null;
  completionProbability: number | null;
  shareProbability: number | null;
  commentProbability: number | null;
  saveProbability: number | null;
  // Weakest-supported of the 7 - no speaker-trust signal is wired into
  // Phase 9's inputs, see the contract's own doc comment.
  followProbability: number | null;
}

export interface ViralityPrediction {
  clipId: string;
  // Composite - the average of every non-null probability. Null only
  // when ALL 7 are null - a real, honest result, not a fabricated 0.5.
  // Named to match the spec's own "Overall Viral Score" (Phase 7's
  // `viralityProbability` field name was retired in Phase 9).
  overallViralScore: number | null;
  // Coverage-only, same "coverage, not accuracy" meaning as
  // HookPredictionOutput's own confidence. count(non-null)/7 (was /8
  // before Phase 9).
  confidence: number;
  reason: string;
  subProbabilities: ViralitySubProbabilities;
}

// AI Intelligence v4, Phase 10 (Retention Curve Insights, spec Part 5
// extension - see docs/ai/intelligence-v4.md). Mirrors
// @speedora/contracts' retentionPointSchema rather than importing it -
// same duplication precedent as ViralitySubProbabilities above. `score` is
// RELATIVE within this clip's own points only, same "not comparable
// across clips" caveat MomentumCurve's momentumScore/EmotionalArc's
// intensity already carry.
export interface RetentionPoint {
  t: number;
  score: number;
}

// A new ADDITIVE layer over Phase 4's MomentumCurve and Phase 5's
// EmotionalArc (ADR D13, docs/ai/intelligence-v4.md's Parts 4-15
// re-audit) - unlike Phase 9's realignment, MomentumCurve/EmotionalArc
// themselves are unchanged, only consumed. Every array can be empty (not
// null) - a real, honest "no such point found" result. No confidence
// field, same "pure derive with no natural weighted-budget concept"
// reasoning Phase 4/5/6 already established.
export interface RetentionCurveInsights {
  clipId: string;
  dropPoints: RetentionPoint[];
  replayZones: RetentionPoint[];
  emotionalPeaks: RetentionPoint[];
  curiosityPeaks: RetentionPoint[];
}

// AI Intelligence v4, Phase 11 (Multimodal Reasoning Engine, spec Part 6 -
// see docs/ai/intelligence-v4.md). Mirrors @speedora/contracts'
// multimodalEvidenceSchema/multimodalConnectionSchema/
// multimodalReasoningResultSchema rather than importing them - same
// duplication precedent as ViralitySubProbabilities/RetentionPoint above.
//
// 'transcript'/'scene'/'ocr'/'face'/'gesture'/'audio'/'speaker' are Part
// 6's own 7 NORMATIVE modalities; 'object' (Object Intelligence's
// objectTracks) is a deliberate, DOCUMENTED EXTENSION beyond the spec, not
// a Part 6 requirement itself - see @speedora/contracts'
// MODALITY_SOURCES comment. 'timing' is not a modality of its own - every
// evidence item below carries its own startTime/endTime instead.
export type ModalitySource =
  'transcript' | 'scene' | 'ocr' | 'face' | 'gesture' | 'audio' | 'speaker' | 'object';

export interface MultimodalEvidence {
  id: string;
  modality: ModalitySource;
  startTime: number;
  endTime: number;
  speakerId: string | null;
  value: string;
  confidence: number | null;
  provenance: string;
}

export type MultimodalRelationType = 'refers_to' | 'co_occurs_with' | 'emphasizes';

export interface MultimodalConnection {
  relation: MultimodalRelationType;
  evidenceRefs: string[];
  modalities: ModalitySource[];
  startTime: number;
  endTime: number;
  confidence: number;
  reason: string;
}

// `connections` empty (evidence non-empty) is a REAL, SUCCESSFUL result -
// same "a degenerate-but-real result isn't an error" convention as Phase
// 2's empty SemanticEvent[]/Phase 3's `unsegmented: true`.
export interface MultimodalReasoningResult {
  clipId: string;
  evidence: MultimodalEvidence[];
  connections: MultimodalConnection[];
  modalityCoverage: Record<string, number>;
}

// AI Intelligence v4 Track B, Phase A1 (Subtitle Rewriter, spec Part 7 -
// see docs/ai/subtitle-intelligence.md). Mirrors @speedora/contracts'
// subtitleLineSchema/highlightMomentSchema/subtitleIntelligenceSchema
// rather than importing them - same duplication precedent as
// ViralitySubProbabilities/RetentionPoint/MultimodalReasoningResult above.
// ADR DB1 (resolved via AskUserQuestion before implementation): `words` is
// the exact, UNMODIFIED sub-sequence of the source segment's own words -
// this is a STRUCTURAL re-chunker, never a lexical rewrite.
export interface SubtitleLine {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  speaker?: string;
  emphasisWordIndices: number[];
}

export type SubtitleTimeline = SubtitleLine[];

// A "punch-worthy" moment - `score` is RELATIVE within this clip's own
// moments only, same "not comparable across clips" caveat every other v4
// 0-1 score already carries.
export interface HighlightMoment {
  start: number;
  end: number;
  score: number;
}

export type HighlightTimeline = HighlightMoment[];

export interface SubtitleIntelligence {
  clipId: string;
  timeline: SubtitleTimeline;
  highlights: HighlightTimeline;
}

// AI Intelligence v4 Track B, Phase B1 (Dynamic Caption Engine, spec Part
// 8 - data only, see docs/ai/subtitle-intelligence.md). Mirrors
// @speedora/contracts' captionSizeTierSchema/captionAnimationSchema/
// treatmentMomentSchema rather than importing them - same duplication
// precedent as every other v4 type in this file. 'normal'/'none' are each
// axis's majority-case default.
export type CaptionSizeTier = 'small' | 'normal' | 'large';
export type CaptionAnimation = 'none' | 'punch' | 'attention';

export interface TreatmentMoment {
  start: number;
  end: number;
  sizeTier: CaptionSizeTier;
  animation: CaptionAnimation;
}

// A dense, 1:1-with-SubtitleTimeline array (not a filtered/sparse one like
// HighlightTimeline) - bare array, no clipId wrapper, same shape as
// MomentumCurve/EmotionalArc.
export type CaptionTreatmentTimeline = TreatmentMoment[];

// AI Intelligence v4 Track B, Phase C1 (Visual Emphasis Engine, spec Part
// 9 - data only, see docs/ai/visual-emphasis-engine.md). Mirrors
// @speedora/contracts' editingTechniqueSchema/editingSuggestionSchema
// rather than importing them - same duplication precedent as every other
// v4 type in this file. `score` is RELATIVE within this clip's own
// suggestions only, same "not comparable across clips" caveat every other
// v4 0-1 score already carries. 'attention_cut' is NOT one of spec Part
// 9's 9 named techniques - see @speedora/contracts' own comment on
// EDITING_TECHNIQUES for why it reuses this same shape anyway.
export type EditingTechnique =
  | 'digital_push'
  | 'ocr_highlight'
  | 'focus_shift'
  | 'reaction_hold'
  | 'pause_hold'
  | 'attention_cut';

export interface EditingSuggestion {
  technique: EditingTechnique;
  start: number;
  end: number;
  score: number;
  reason: string;
}

// Bare array, filtered/sparse like HighlightTimeline (not dense like
// CaptionTreatmentTimeline) - one entry per detected editing opportunity,
// not one per input sample.
export type EditingSuggestionTimeline = EditingSuggestion[];

// AI Fusion roadmap's Face Intelligence initiative, Batch 2 - a per-sample
// looking-direction bucket, 'center' meaning both iris position and head
// rotation roughly face the camera. Mirrors @speedora/contracts'
// LookingDirection shape rather than importing it - same duplication
// precedent as FacialEmotion/GestureFeatures above.
export type LookingDirection = 'center' | 'left' | 'right' | 'up' | 'down';

// AI Fusion roadmap's Face Intelligence initiative, Batch 5D (Emotion
// Heuristic) - deliberately SAFE, non-diagnostic vocabulary (never a
// discrete emotion name). Mirrors @speedora/contracts' AffectLabel shape
// rather than importing it, same duplication precedent as
// LookingDirection above.
export type AffectLabel =
  'positive_affect' | 'high_energy' | 'low_energy' | 'expressive' | 'neutral';

export interface FaceLandmarkFeatures {
  blinkRate: number | null;
  averageSmile: number | null;
  averageMouthOpen: number | null;
  averageAbsoluteYaw: number | null;
  averageAbsolutePitch: number | null;
  positionScore: number | null;
  sizeScore: number | null;
  visibilityScore: number | null;
  // Batch 2 (Eye Contact/Looking Direction) - fraction of samples-with-a-
  // face resolved to lookingDirection 'center', and the most frequent
  // resolved direction overall. A coarse heuristic proxy, not calibrated
  // gaze tracking - see @speedora/facial-intelligence's
  // deriveFaceLandmarkFeatures for the exact thresholds.
  eyeContactRate: number | null;
  dominantLookingDirection: LookingDirection | null;
  // Batch 3 (Blur/Sharpness/Lighting/Occlusion) - averageSharpness/
  // averageBrightness left in raw units (Laplacian-variance / 0-255), same
  // "normalized later in fusion-engine" convention as averageAbsoluteYaw/
  // Pitch above. occlusionRate is already a 0-1 rate (fraction of samples
  // flagged as possibly occluded) - a coarse proxy, not a trained
  // occlusion classifier, see @speedora/facial-intelligence's own caveat.
  averageSharpness: number | null;
  averageBrightness: number | null;
  occlusionRate: number | null;
  // Batch 4 (Face Re-identification/Tracking, Speaker Face Selection) -
  // derived from the trackId sequence (speakerChangeCount/
  // dominantSpeakerConsistency) and, optionally, correlated against the
  // clip's transcript audio timing (speakerAudioSyncRate - null when no
  // audio-timing data was supplied to deriveFaceLandmarkFeatures at all, not
  // merely inconclusive). See @speedora/contracts' faceLandmarkFeaturesSchema
  // for the full rationale.
  speakerChangeCount: number | null;
  dominantSpeakerConsistency: number | null;
  speakerAudioSyncRate: number | null;
  // Batch 5A (Lip Activity) - temporal dynamics on top of averageMouthOpen
  // above, all derived from the same jawOpen blendshape sequence. See
  // @speedora/contracts' faceLandmarkFeaturesSchema for the exact formulas
  // and honest caveats.
  averageLipVelocity: number | null;
  speakingIntensity: number | null;
  pauseCount: number | null;
  articulationRate: number | null;
  // Batch 5B (Smile & Laugh) - averageMouthWidth is raw units (a scale-
  // invariant ratio, normalized later in fusion-engine). genuineSmileRate
  // is a coarse Duchenne-marker heuristic (smile + cheek-raise + eye-
  // squint co-occurring), not a trained/validated classifier - see
  // @speedora/contracts' faceLandmarkFeaturesSchema for the exact
  // thresholds and honest caveats.
  averageMouthWidth: number | null;
  averageCheekRaise: number | null;
  averageEyeSquint: number | null;
  genuineSmileRate: number | null;
  // Batch 5C (Blink & Eye Behavior) - blinkFrequencyPerMinute/
  // prolongedClosureCount derived from blink-blendshape runs;
  // gazeStabilityScore from continuous (not bucketed) gaze offset
  // consistency. See @speedora/contracts' faceLandmarkFeaturesSchema for
  // the exact formulas and honest caveats.
  blinkFrequencyPerMinute: number | null;
  prolongedClosureCount: number | null;
  gazeStabilityScore: number | null;
  // Batch 5D (Emotion Heuristic) - averageBrowActivity/averageHeadMovementRate
  // are raw units, normalized later in fusion-engine. dominantAffect is a
  // deliberately SAFE, non-diagnostic label from a deterministic (not
  // trained) decision tree combining Smile+Jaw/Speaking+Eyebrow+Head
  // movement - see @speedora/contracts' faceLandmarkFeaturesSchema for the
  // full rationale and honest caveats. affectConfidence is a coverage
  // score (fraction of contributing signals available), not a statistical
  // confidence.
  averageBrowActivity: number | null;
  averageHeadMovementRate: number | null;
  dominantAffect: AffectLabel | null;
  affectConfidence: number | null;
}

// AI Fusion roadmap's Face Intelligence initiative, Batch 4.5 (Quality
// Metrics & Telemetry) - explicitly NOT a scoring signal, purely
// explainability/audit telemetry over Batch 4's Kalman+Hungarian+IoU+pose
// tracker. Mirrors @speedora/contracts' trackSegmentQualitySchema/
// faceTrackingQualityMetricsSchema shapes rather than importing them, same
// duplication precedent as FaceLandmarkSample/Features above. See
// @speedora/facial-intelligence's deriveTrackingQualityMetrics for every
// threshold's honest "unvalidated guess" caveat.
export interface TrackSegmentQuality {
  trackId: number;
  frameCount: number;
  startTime: number;
  endTime: number;
  occlusionRatio: number | null;
  confidence: number | null;
  idSwitchCount: 0 | 1;
  stable: boolean;
}

export interface FaceTrackingQualityMetrics {
  trackFragmentationRate: number | null;
  idSwitchCount: number | null;
  lostTrackDurationSeconds: number | null;
  reidentificationSuccessRate: number | null;
  faceVisibilityRatio: number | null;
  faceOcclusionRatio: number | null;
  averageLandmarkConfidence: number | null;
  landmarkJitterScore: number | null;
  kalmanCorrectionRatio: number | null;
  trackingConfidence: number | null;
  tracks: TrackSegmentQuality[];
}

// Speaker Intelligence roadmap, Milestone A - mirrors
// @speedora/contracts' active-speaker.ts shapes rather than importing them,
// same duplication precedent as FaceLandmarkSample/Features above.
export interface ActiveSpeakerSample {
  t: number;
  activeTrackId: number | null;
  confidence: number | null;
}

export type SpeakerFaceMatchStatus = 'matched' | 'unknown';

export interface SpeakerFaceAssociation {
  speaker: string;
  faceTrackId: number | null;
  status: SpeakerFaceMatchStatus;
  confidence: number;
}

export interface LipSyncVerification {
  faceTrackId: number;
  lipMotionScore: number | null;
  audioSyncScore: number | null;
  delayMs: number | null;
  frameOffset: number | null;
  verified: boolean | null;
}

// Speaker Intelligence roadmap, Milestone B - mirrors
// @speedora/contracts' speaker-diarization.ts/speaker-timeline.ts shapes
// rather than importing them, same duplication precedent as
// ActiveSpeakerSample above.
export interface SpeakerSegment {
  speaker: string;
  start: number;
  end: number;
  durationSeconds: number;
}

export interface OverlappingSpeechInterval {
  start: number;
  end: number;
  speakers: string[];
}

export interface SilenceInterval {
  start: number;
  end: number;
}

export interface DiarizationFeatures {
  speakerCount: number;
  segments: SpeakerSegment[];
  speakerDurationsSeconds: Record<string, number>;
  turnCount: number;
  switchCount: number;
  overlappingSpeech: OverlappingSpeechInterval[];
  silences: SilenceInterval[];
}

export interface SpeakerTimelineEntry {
  speaker: string;
  start: number;
  end: number;
  faceTrackId: number | null;
  isActiveOnScreen: boolean | null;
}

export interface SpeakerTransition {
  t: number;
  fromSpeaker: string | null;
  toSpeaker: string;
}

export interface SpeakerTimelineFeatures {
  transitions: SpeakerTransition[];
  transitionCount: number;
}

// Speaker Intelligence roadmap, Milestone C - mirrors
// @speedora/contracts' speaker-scoring.ts shapes rather than importing
// them, same duplication precedent as SpeakerSegment above. `role` is an
// explicit input no detector in this codebase infers - see
// @speedora/speaker-scoring's deriveSpeakerImportanceScore comment.
export type SpeakerRole = 'host' | 'guest' | 'audience' | 'unknown';

export interface SpeakerConfidenceScore {
  speakerId: string;
  eyeContactRate: number | null;
  headPoseStability: number | null;
  gestureActivity: number | null;
  voiceStability: number | null;
  speakingRateScore: number | null;
  overallScore: number | null;
}

export interface SpeakerEngagementScore {
  speakerId: string;
  gestureScore: number | null;
  voiceEnergyScore: number | null;
  facialExpressionScore: number | null;
  speakingRateScore: number | null;
  overallScore: number | null;
}

export interface SpeakerImportanceScore {
  speakerId: string;
  role: SpeakerRole | null;
  talkTimeRatio: number | null;
  screenTimeRatio: number | null;
  score: number | null;
}

export interface SpeakerHighlightMoment {
  speakerId: string;
  start: number;
  end: number;
  isActiveSpeaker: boolean | null;
  emotionIntensity: number | null;
  gestureIntensity: number | null;
  eyeContactRate: number | null;
  hookStrength: number | null;
  score: number | null;
}

// Fase 29/31 (Mini Fusion Engine v1 -> v2) - @speedora/fusion-engine's
// feature-level breakdown: one entry per extracted+normalized+weighted
// named feature (not one opaque sub-score per signal) - see
// packages/contracts/src/fusion.ts's fusionContributionSchema.
export interface FusionContribution {
  signal: string;
  feature: string;
  rawValue: number | null;
  normalizedValue: number;
  weight: number;
  weightedContribution: number;
}

export type FusionBreakdown = FusionContribution[];

export interface FusionFactor {
  signal: string;
  feature: string;
  weightedContribution: number;
  description: string;
}

export interface FusionExplainability {
  topFactors: FusionFactor[];
}

// Fase 32 (Mini Fusion Engine v2 - Prediction & Recommendation stages) -
// @speedora/fusion-engine's deterministic, non-ML-trained bucket + human-
// readable action derived purely from highlightScore/confidence/
// contributions already computed above - same "heuristic, not a trained
// model" honesty as the rest of the Fusion Engine.
export type PredictionBucket = 'likely_high_performer' | 'uncertain' | 'likely_low_performer';

export interface FusionPrediction {
  bucket: PredictionBucket;
  rationale: string;
}

export interface FusionRecommendation {
  action: string;
  message: string;
}

export interface ClipCandidate {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  viralityScore: number;
  transcript: TranscriptSegment[];
  // Suggested 3-second-opener hook line and social hashtags (without a
  // leading '#') from the same detect-clips LLM call that scores virality -
  // see CLAUDE.md's Fase 5 section. hookText is null if the LLM call
  // failed/returned nothing for this candidate - that's not an error, just
  // missing metadata the user can fill in manually.
  hookText: string | null;
  hashtags: string[];
  // Fase 8 (Content Intelligence) - see ClipScores above and
  // schema.prisma's comments on Clip.scores/.reason/etc. All null/empty
  // for the same reason hookText can be null: the LLM call's per-candidate
  // metadata is best-effort, not something that can fail the whole job.
  scores: ClipScores | null;
  reason: string | null;
  topics: string[];
  keywords: string[];
  intent: string | null;
  ctaText: string | null;
  // Fase 23 (DB+JSON-contract roadmap) - deterministic keyword-pattern
  // suggestions from @speedora/emoji-suggester, computed from this clip's
  // own transcript text. Never empty/null-vs-array ambiguity: always an
  // array (possibly empty), same convention as hashtags/topics/keywords.
  emojiSuggestions: string[];
}

export interface Video {
  id: string;
  ownerId: string;
  // Sprint 6K (Conversion) - already present on every API response (the
  // backend never selected it out), just never typed until a client needed
  // it: the clip-performance page needs this to call the workspace-scoped
  // POST /workspaces/:workspaceId/tracked-links.
  workspaceId: string;
  sourceUrl: string;
  // Sprint 1-2 (Dashboard Redesign) - display name only, null for rows
  // created before this field existed (see schema.prisma's comment on
  // Video.title) - the Dashboard falls back to "Untitled video".
  title: string | null;
  status: VideoStatus;
  // Prisma's `durationSeconds Float?` serializes as `null`, not `undefined`,
  // once it round-trips through JSON.
  durationSeconds: number | null;
  // Sprint 1-2 (Dashboard Redesign) - feeds the Dashboard's per-owner
  // Storage Used stat (see schema.prisma's comment on Video.sourceSizeBytes).
  sourceSizeBytes: number | null;
  // Quality Validation roadmap (Fase 0 design, Phase 1) - written once by
  // probe-video.worker.ts's ffprobe pass (see schema.prisma's own comment
  // on these columns). All null until that pass completes, or for any
  // pre-existing row.
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  videoBitrate: number | null;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  audioBitrate: number | null;
  // The structured Error/Warning/Info result of packages/video-validation's
  // rule evaluation (Phase 2), written by probe-video.worker.ts - null for
  // any video whose probe failed with an Error-tier finding (see
  // ValidationReport's own comment) or predates this field.
  validationReport: ValidationReport | null;
  // Product Experience roadmap - already a `/videos/:id/thumbnail` relative
  // endpoint path (see VideosService.mapVideoWithClips), never the raw
  // object-storage key - same treatment as Clip.downloadUrl below. Null
  // until transcribe.worker.ts's best-effort extraction succeeds, or for
  // pre-existing rows (never backfilled).
  thumbnailUrl: string | null;
  // Phase 2 (image optimization roadmap) - a tiny base64 data URL (~16px
  // wide), inlined directly rather than behind its own endpoint like the
  // full thumbnail - small enough to ship with the DTO, and the whole point
  // is having *something* to paint before the real image loads. Null
  // whenever thumbnailUrl is null (same lifecycle).
  thumbnailBlurDataUrl: string | null;
  // Phase 3 (Animated Thumbnail roadmap) - already a `/videos/:id/animated-thumbnail`
  // relative endpoint path (same "never the raw storage key" treatment as
  // thumbnailUrl above). Null while extraction is still pending/failed, or
  // for pre-existing rows.
  animatedThumbnailUrl: string | null;
  // Phase 3 (Hover Preview roadmap) - already a `/videos/:id/hover-preview`
  // relative endpoint path (same treatment as animatedThumbnailUrl above),
  // fetched by the frontend on-demand only on hover/focus (see
  // lib/useHoverPreview.ts) rather than always shown. Null while extraction
  // is still pending/failed, or for pre-existing rows.
  hoverPreviewUrl: string | null;
  // Phase 3 (Storyboard roadmap) - already an array of `/videos/:id/storyboard/:index`
  // relative endpoint paths (see VideosService.mapVideoWithClips), one per
  // successfully extracted frame - never a fixed-N assumption, since each
  // frame is its own independent best-effort extraction and some can fail
  // while others succeed. Empty (not null) when extraction hasn't produced
  // any frames yet, or for pre-existing rows.
  storyboardFrameUrls: string[];
  // 0-100, real progress reported by import-youtube.worker.ts (see
  // schema.prisma's comment on this column) - null before an import
  // attempt has started or once status has moved past IMPORTING. Only
  // meaningful while status === IMPORTING; the frontend's per-stage
  // progress bar ignores it otherwise.
  importProgress: number | null;
  // 0-100, real progress reported by transcribe.worker.ts (see
  // schema.prisma's comment on this column) - null before a transcribe
  // attempt has started or once status has moved past UPLOADED. Only
  // meaningful while status === UPLOADED (the Transcribe stage); the
  // frontend's per-stage progress bar ignores it otherwise.
  transcribeProgress: number | null;
  transcriptionProvider: TranscriptionProvider;
  // Pre-Processing Settings roadmap (Phase 0/1) - the settings snapshot
  // chosen on the pre-upload settings screen (see ProcessingOptions' own
  // comment); null for every video created before this field existed, or
  // when the settings screen was skipped.
  processingOptions: ProcessingOptions | null;
  createdAt: string;
  updatedAt: string;
}

// AI Intelligence v4 Phase 14.1 (Clip Ranking Engine, Stage D - see
// docs/ai/clip-ranking-engine.md). Mirrors @speedora/contracts'
// ClipRankSubScores rather than importing it - same duplication precedent
// as ViralitySubProbabilities/RetentionPoint above.
export interface ClipRankSubScores {
  fusion: number | null;
  virality: number | null;
  narrative: number | null;
  hook: number | null;
  retention: number;
  semanticImportance: number | null;
  novelty: number;
  emotion: number;
  practicalValue: number;
  educationalValue: number;
  curiosity: number;
  trustAuthority: number;
}

// Client-facing shape for a Clip - deliberately not the same as
// packages/database's Prisma `Clip` model (that's the DB row, including
// `outputUrl`, the raw object storage key; this is the API/UI-facing DTO,
// with a relative `downloadUrl` instead - see VideosService.mapVideoWithClips
// and ClipsService's own toDto()).
export interface Clip {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  // AI Clip Library roadmap (P1) - denormalized endTime - startTime, kept in
  // sync at every write site that sets startTime/endTime. Exists so the
  // clip library filter/sort can use a plain indexed column instead of
  // making every caller recompute it - same reasoning as Video.durationSeconds.
  // Null only for pre-existing rows before the backfill script runs.
  durationSeconds: number | null;
  viralityScore: number;
  downloadUrl: string | null;
  // Sprint 1-2 (Dashboard Redesign) - feeds the Dashboard's per-owner
  // Storage Used stat (see schema.prisma's comment on Clip.outputSizeBytes).
  // Null until the clip finishes rendering.
  outputSizeBytes: number | null;
  // Product Experience roadmap - a `/clips/:id/thumbnail` relative endpoint
  // path (same "never the raw storage key" treatment as downloadUrl above),
  // extracted from the RENDERED output by render-clip.worker.ts. Null until
  // the clip finishes rendering, extraction fails, or for pre-existing rows.
  thumbnailUrl: string | null;
  // Phase 2 (image optimization roadmap) - same inline-base64 blur-placeholder
  // treatment as Video.thumbnailBlurDataUrl above.
  thumbnailBlurDataUrl: string | null;
  // Phase 3 (Animated Thumbnail roadmap) - same treatment as
  // Video.animatedThumbnailUrl above, extracted from the RENDERED output by
  // render-clip.worker.ts.
  animatedThumbnailUrl: string | null;
  // Phase 3 (Hover Preview roadmap, "Clip Preview") - same treatment as
  // Video.hoverPreviewUrl above, extracted from the RENDERED output by
  // render-clip.worker.ts.
  hoverPreviewUrl: string | null;
  // Phase 3 (Storyboard roadmap) - same "array of endpoint paths, one per
  // successfully extracted frame" treatment as Video.storyboardFrameUrls
  // above, extracted from the RENDERED output by render-clip.worker.ts.
  storyboardFrameUrls: string[];
  captionStyle: CaptionStyle;
  // Subtitle Studio roadmap (P2c) - orthogonal to captionStyle, composes
  // with any preset. False by default (unchanged rendering) for every
  // existing clip.
  speakerColorCaptions: boolean;
  // AI Intelligence v4 Track B, Phase A2 (Subtitle Rewriter render wiring -
  // see docs/ai/subtitle-intelligence.md) - opts this clip's captions into
  // Clip.subtitleIntelligence's structural re-chunking, orthogonal to
  // captionStyle, same shape as speakerColorCaptions above. False by
  // default (unchanged rendering) for every existing clip; also requires
  // the global SUBTITLE_REWRITE_ENABLED flag and is skipped whenever a
  // translation is requested (see render-clip.worker.ts).
  smartSegmentation: boolean;
  // AI Intelligence v4 Track B, Phase B2 (Dynamic Caption Engine render
  // wiring - see docs/ai/subtitle-intelligence.md, ADR DB11) - opts this
  // clip's captions into Clip.captionTreatment's per-line size/animation
  // treatment, orthogonal to captionStyle, same shape as smartSegmentation
  // above. Can only actually apply when smartSegmentation is ALSO on for
  // this render (dynamic captions have no meaning without
  // Clip.subtitleIntelligence's own lines).
  dynamicCaptions: boolean;
  // Subtitle Studio roadmap (P2f) - which TranscriptSegment.translations key
  // to burn in; null means the original (untranslated) text.
  captionLanguage: string | null;
  // Subtitle Presets roadmap (P3b) - per-clip override of the resolved
  // caption font; null means "use Brand Kit resolution" (see
  // ClipsService.resolveFontFamily's precedence).
  fontFamily: string | null;
  // Watermark roadmap (P3c) - per-clip on/off gate for the owner's Brand
  // Kit watermark, same shape as applyBrandKit (composable with it - a clip
  // can use the Brand Kit's font while skipping its watermark).
  watermarkEnabled: boolean;
  // Intro roadmap (P3d) - per-clip on/off gate for the owner's Brand Kit
  // intro, same shape as watermarkEnabled.
  introEnabled: boolean;
  // Outro roadmap (P3e) - same shape as introEnabled.
  outroEnabled: boolean;
  hookText: string | null;
  hashtags: string[];
  // Fase 8 (Content Intelligence) - see ClipCandidate/ClipScores above.
  scores: ClipScores | null;
  reason: string | null;
  topics: string[];
  keywords: string[];
  intent: string | null;
  ctaText: string | null;
  // Fase 23 (DB+JSON-contract roadmap) - see ClipCandidate above.
  emojiSuggestions: string[];
  // Fase 27 (Facial Intelligence, AI Fusion roadmap Phase C) - null when the
  // analysis wasn't run or failed entirely for this clip (distinct from an
  // empty array, which would mean "ran successfully and found nothing") -
  // same nullability convention as `scores` above. Computed at render-clip
  // time (not detect-clips time, unlike scores/topics/etc.), so it isn't on
  // ClipCandidate.
  facialEmotions: FacialEmotionSample[] | null;
  // Batch SC-1 (Scene Intelligence taxonomy expansion, on top of Fase 26) -
  // classifySceneCutTypes()'s per-cut hard_cut/fade/dissolve classification,
  // one entry per this clip's `sceneCuts` timestamp (not itself exposed via
  // the API - see @speedora/contracts' Fase 27 comment on why a Float[]
  // column was never wired through). Null when classification wasn't run or
  // failed entirely for this clip, distinct from an empty array (no cuts to
  // classify at all) - same nullability convention as facialEmotions below.
  sceneCutEvents: SceneCutEvent[] | null;
  // Fase 30 (Gesture Intelligence, AI Fusion roadmap Checkpoint 2) - same
  // null-vs-empty-array convention as facialEmotions above.
  gestures: GestureSample[] | null;
  // Fase 28/30 (Mini Fusion Engine v1 prep, AI Fusion roadmap Checkpoint
  // 1/2) - dense derived summaries computed from sceneCuts/facialEmotions/
  // gestures/this clip's own transcript segments (see AudioFeatures/
  // SceneFeatures/FacialEmotionFeatures/GestureFeatures above) - what the
  // Fusion Engine actually consumes, not the raw timelines. sceneCuts/
  // audioFeatures/sceneFeatures are always computed (their raw inputs are
  // always arrays, even if empty); facialFeatures/gestureFeatures are null
  // exactly when facialEmotions/gestures are null.
  audioFeatures: AudioFeatures | null;
  sceneFeatures: SceneFeatures | null;
  // Batch SC-2 (Scene Intelligence taxonomy expansion) - `motionEnergy`
  // (raw samples) is never null (unlike facialEmotions/gestures/ocrText) -
  // analyzeMotionEnergy() never fails the job, so the underlying column
  // defaults to an empty array rather than needing a null-vs-empty
  // distinction. `motionEnergyFeatures` is always computed, same convention
  // as sceneFeatures above.
  motionEnergy: MotionEnergySample[];
  motionEnergyFeatures: MotionEnergyFeatures | null;
  // Batch SC-3 (Scene Intelligence taxonomy expansion) - `cameraMotion` is a
  // Python/OpenCV subprocess result (unlike motionEnergy's ffmpeg-based
  // "always an array"), so it follows facialEmotions/gestures' null-vs-
  // empty-array convention instead: null when the analysis wasn't run or
  // failed entirely, distinct from an empty array. `cameraMotionFeatures`
  // is null exactly when `cameraMotion` is null.
  cameraMotion: CameraMotionSample[] | null;
  cameraMotionFeatures: CameraMotionFeatures | null;
  // Taxonomy category F (Editing Rhythm) - a COMPOSITE signal, no separate
  // raw column (see schema.prisma's own comment) - always computed, same
  // convention as sceneFeatures/motionEnergyFeatures above.
  editingRhythmFeatures: EditingRhythmFeatures | null;
  facialFeatures: FacialEmotionFeatures | null;
  gestureFeatures: GestureFeatures | null;
  // Fase 32 - the same Fase 8 ClipScores this clip's `scores` field already
  // carries, echoed back here as what the Fusion Engine's `llm` signal
  // actually consumed at render time (threaded through the render-clip job
  // payload - see RenderClipJobData.scores) - null for a clip whose
  // detect-clips LLM call never ran/produced no scores.
  llmFeatures: ClipScores | null;
  // AI Fusion roadmap's Face Intelligence initiative, Batch 1 - same null-
  // vs-empty-array convention as facialEmotions/gestures above. Distinct
  // from facialEmotions/facialFeatures (a separate subprocess/model -
  // expression classification vs. MediaPipe FaceLandmarker geometry).
  faceLandmarks: FaceLandmarkSample[] | null;
  faceLandmarkFeatures: FaceLandmarkFeatures | null;
  // Batch 4.5 (Quality Metrics & Telemetry) - explainability/audit
  // telemetry over faceLandmarks' own tracking, NOT consumed by
  // @speedora/fusion-engine at all (unlike every other *Features field
  // above). Null exactly when faceLandmarks is null.
  trackingQualityMetrics: FaceTrackingQualityMetrics | null;
  // AI Fusion roadmap's OCR initiative, Batch OCR-1 - @speedora/ocr-
  // intelligence's detectOcrText() per-sample output (Tesseract text +
  // bounding box + confidence per sampled frame). Null (not []) when the
  // whole analysis failed to run.
  ocrText: OcrSample[] | null;
  // Batch OCR-2 - trackOcrText()+classifyOcrTrack()'s "store everything"
  // per-instance layer (ocrTracks) and deriveOcrFeatures()'s aggregate
  // Fusion-Engine-ready summary (ocrFeatures) - both null exactly when
  // ocrText is null.
  ocrTracks: OcrTextTrack[] | null;
  ocrFeatures: OcrFeatures | null;
  // Object Intelligence roadmap, Batch OI-1 (Foundation) -
  // @speedora/object-intelligence's detectObjects() per-sample output
  // (MediaPipe Object Detector/EfficientDet-Lite0). Null (not []) when the
  // whole analysis failed to run.
  objects: ObjectSample[] | null;
  // trackObjects()'s "store everything" per-instance layer (objectTracks)
  // and deriveObjectFeatures()'s aggregate Fusion-Engine-ready summary
  // (objectFeatures) - both null exactly when objects is null.
  objectTracks: ObjectTrack[] | null;
  objectFeatures: ObjectFeatures | null;
  // Fase 29/31 (Mini Fusion Engine v1 -> v2) - @speedora/fusion-engine's
  // computeHighlightScore() output, combining whichever of
  // audioFeatures/sceneFeatures/facialFeatures/gestureFeatures were
  // available (weighted per-signal, see @speedora/fusion-engine's
  // weights.ts - gesture currently has weight 0, so its data can be
  // present here without moving highlightScore). highlightScore null means
  // the sum of weighted contributions was zero (not a fabricated 0/50);
  // highlightBreakdown/highlightExplainability/highlightReason are always
  // populated once computeHighlightScore runs, even when highlightScore
  // itself ends up null. highlightConfidence is a heuristic coverage+
  // quality estimate, NOT a calibrated probability.
  highlightScore: number | null;
  highlightBreakdown: FusionBreakdown;
  highlightExplainability: FusionExplainability;
  highlightConfidence: number | null;
  highlightReason: string | null;
  // Fase 32 (Mini Fusion Engine v2 - Prediction & Recommendation stages) -
  // always populated once computeHighlightScore runs (same as
  // highlightBreakdown/highlightExplainability above), even when
  // highlightScore itself ends up null.
  highlightPrediction: FusionPrediction | null;
  highlightRecommendation: FusionRecommendation | null;
  // Rank among sibling clips of the same video by highlightScore - null
  // until every clip in the video has finished rendering (see
  // render-clip.worker.ts's rankClips() call).
  highlightRank: number | null;
  // Composition Intelligence roadmap - wired into the Fusion Engine at
  // weight 0 pending calibration (see ARCHITECTURE.md's Composition
  // Intelligence section). Null when there were zero usable primary-subject
  // samples for this clip, same nullability convention as
  // motionEnergyFeatures/sceneFeatures above.
  compositionFeatures: CompositionFeatures | null;
  // AI Intelligence v4, Phase 1 (Hook Prediction Engine) - computed on every
  // render regardless of HOOK_PREDICTION_ENABLED (the flag gates API
  // exposure, not computation - see isHookPredictionEnabled()). Null only
  // when the render-graph node's own LLM call failed (optional: true,
  // fallback: null - never fails the render job).
  hookPrediction: HookPredictionOutput | null;
  // AI Intelligence v4, Phase 2 (Semantic Event Detection) - computed on
  // every render regardless of SEMANTIC_EVENT_DETECTION_ENABLED (the flag
  // gates API exposure, not computation - see
  // isSemanticEventDetectionEnabled()). Null when the render-graph node's
  // own LLM call failed/never ran; an empty array means it ran and found
  // zero events - a real result, same "array vs null" convention as
  // sceneCutEvents above.
  semanticEvents: SemanticEvent[] | null;
  // AI Intelligence v4, Phase 3 (Narrative Graph) - computed on every
  // render regardless of NARRATIVE_GRAPH_ENABLED (the flag gates API
  // exposure, not computation - see isNarrativeGraphEnabled()). Null when
  // the render-graph node's own LLM call failed/never ran; a present
  // object (including the `unsegmented: true` case) means it ran
  // successfully - a real result, not a failure.
  narrativeGraph: NarrativeGraph | null;
  // AI Intelligence v4, Phase 4 (Contextual Momentum) - computed on every
  // render regardless of CONTEXTUAL_MOMENTUM_ENABLED (the flag gates API
  // exposure, not computation - see isContextualMomentumEnabled()). Unlike
  // hookPrediction/semanticEvents/narrativeGraph above, this node is pure
  // (no LLM call, can't fail in that sense) - null here can only mean this
  // Clip row predates this phase's migration; once computed, always a real
  // (possibly empty) array.
  contextualMomentum: MomentumCurve | null;
  // AI Intelligence v4, Phase 5 (Emotional Arc) - computed on every render
  // regardless of EMOTIONAL_ARC_ENABLED (the flag gates API exposure, not
  // computation - see isEmotionalArcEnabled()). Same null-semantics as
  // contextualMomentum above (pure, not LLM-backed) - null here can only
  // mean this Clip row predates this phase's migration; once computed,
  // always a real (possibly empty) array.
  emotionalArc: EmotionalArc | null;
  // AI Intelligence v4, Phase 6 (Multi-speaker Reasoning) - computed on
  // every render regardless of MULTI_SPEAKER_REASONING_ENABLED (the flag
  // gates API exposure, not computation - see
  // isMultiSpeakerReasoningEnabled()). Null-semantics are a THIRD pattern,
  // different from both Phase 4/5's "predates migration" null: it also
  // means "this clip doesn't have 2+ distinct speakers" - the module's own
  // genuine, by-design result for the majority single-speaker case, not
  // distinguished from "predates migration" at this field's level.
  multiSpeakerBreakdown: MultiSpeakerBreakdown | null;
  // AI Intelligence v4, Phase 7 (Cross-module Fusion, spec Part 4 -
  // Virality Engine) - computed on every render regardless of
  // VIRALITY_ENGINE_ENABLED (the flag gates API exposure, not computation
  // - see isViralityEngineEnabled()). Same null-semantics as
  // contextualMomentum/emotionalArc (not multiSpeakerBreakdown's third
  // pattern): this node always produces a real object once it runs, so
  // null here can ONLY mean this Clip row predates this phase's migration.
  viralityPrediction: ViralityPrediction | null;
  // AI Intelligence v4, Phase 10 (Retention Curve Insights, spec Part 5
  // extension) - computed on every render regardless of
  // RETENTION_CURVE_INSIGHTS_ENABLED (the flag gates API exposure, not
  // computation - see isRetentionCurveInsightsEnabled()). Same
  // null-semantics as contextualMomentum/emotionalArc/viralityPrediction:
  // this node always produces a real object once it runs, so null here
  // can ONLY mean this Clip row predates this phase's migration.
  retentionCurveInsights: RetentionCurveInsights | null;
  // AI Intelligence v4, Phase 11 (Multimodal Reasoning Engine, spec Part 6)
  // - computed on every render regardless of MULTIMODAL_REASONING_ENABLED
  // (the flag gates API exposure, not computation - see
  // isMultimodalReasoningEnabled()). Same null-semantics as
  // hookPrediction/semanticEvents/narrativeGraph above (LLM-backed, can
  // fail) - null means the render-graph node's own LLM call
  // failed/never ran, not "predates migration" alone. A present object
  // (including an empty `connections` array) means it ran successfully -
  // a real result, not a failure.
  multimodalReasoning: MultimodalReasoningResult | null;
  // AI Intelligence v4 Track B, Phase A1 (Subtitle Rewriter, spec Part 7) -
  // computed on every render regardless of SUBTITLE_REWRITE_ENABLED (the
  // flag gates API exposure, not computation - see
  // isSubtitleRewriteEnabled()). Same null-semantics as
  // contextualMomentum/emotionalArc/viralityPrediction/
  // retentionCurveInsights: this node always produces a real object once
  // it runs, so null here can ONLY mean this Clip row predates this
  // phase's migration. Does NOT yet affect the actual burned-in captions -
  // see docs/ai/subtitle-intelligence.md's Phase A2.
  subtitleIntelligence: SubtitleIntelligence | null;
  // AI Intelligence v4 Track B, Phase B1 (Dynamic Caption Engine, spec
  // Part 8 - data only) - computed on every render regardless of
  // DYNAMIC_CAPTION_ENABLED (the flag gates API exposure, not computation
  // - see isDynamicCaptionEnabled()). Same null-semantics as
  // contextualMomentum/emotionalArc: this node always produces a real
  // (possibly empty) array once it runs, so null here can ONLY mean this
  // Clip row predates this phase's migration. Does NOT yet affect the
  // actual burned-in captions - Phase B2's job.
  captionTreatment: CaptionTreatmentTimeline | null;
  // AI Intelligence v4 Track B, Phase C1 (Visual Emphasis Engine, spec
  // Part 9 - data only) - computed on every render regardless of
  // VISUAL_EMPHASIS_ENABLED (the flag gates API exposure, not computation
  // - see isVisualEmphasisEnabled()). Same null-semantics as
  // contextualMomentum/emotionalArc/captionTreatment: this node always
  // produces a real (possibly empty) array once it runs, so null here can
  // ONLY mean this Clip row predates this phase's migration. Does NOT yet
  // affect the actual crop-path/render decision - a later phase's job
  // (C2-C7, see docs/ai/visual-emphasis-engine.md).
  editingSuggestions: EditingSuggestionTimeline | null;
  // Phase 4 of the thumbnail roadmap (AI Thumbnail Selection, Level 2) -
  // @speedora/thumbnail-selection's chosen in-clip timestamp, replacing the
  // naive clip-midpoint thumbnailUrl/thumbnailBlurDataUrl are extracted at,
  // plus its explainability breakdown/fallback level/reason. Deliberately
  // NEVER used to pick which clip is a video's cover - that's
  // highlightScore/highlightRank's job (see @speedora/contracts'
  // thumbnail-selection.ts for the full policy). Null for pre-existing rows
  // and if the render graph hasn't run yet.
  thumbnailSelectionTimestamp: number | null;
  thumbnailSelectionBreakdown: ThumbnailContribution[] | null;
  thumbnailSelectionFallback: ThumbnailFallbackLevel | null;
  thumbnailSelectionReason: string | null;
  // Publish attempts to connected social accounts (Fase 6b) - empty until
  // the user hits "Publish now" at least once. Small array in practice (at
  // most one per connected platform account), so returned inline rather
  // than via a separate endpoint.
  publishRecords: PublishRecord[];
  // AI Intelligence v4 Phase 14.1/14.2 (Clip Ranking Engine, Stage D - see
  // docs/ai/clip-ranking-engine.md). A SECOND, additive ranking system
  // alongside highlightScore/highlightRank above (which stay completely
  // untouched, including their own thumbnail cover-clip-selection use) -
  // averages 12 dimensions (Fusion, Virality, Narrative, Hook, Retention,
  // Semantic Importance, and the 6 ClipScores dimensions) into one
  // compositeScore. Recomputed after every sibling clip's own render
  // completes (@speedora/render-clip.worker.ts), scoped to every RENDERED
  // clip for the video. Null for pre-existing rows and for any clip that
  // hasn't finished rendering yet - an unrendered sibling is excluded from
  // the ranked batch entirely, not scored with a placeholder.
  compositeRankScore: number | null;
  // 1 = highest compositeRankScore among this video's rendered clips at
  // the time this was last written - same "last computed at, not a live
  // view" semantics as highlightRank.
  compositeRank: number | null;
  // CODE-COMPUTED coverage: count(non-null of the 12 dimensions)/12 - same
  // "kind of confidence" as ViralityPrediction's own confidence field.
  compositeRankConfidence: number | null;
  // The full 12-dimension breakdown behind compositeRankScore - kept for
  // the same transparency/future-explainability reason
  // highlightBreakdown/highlightExplainability exist alongside
  // highlightScore.
  compositeRankSubScores: ClipRankSubScores | null;
  updatedAt: string;
}

export interface VideoWithClips extends Video {
  clips: Clip[];
}

// Product Experience performance pass - GET /videos was unbounded (every
// video+clip+publishRecord a user ever created, on every 2s dashboard poll),
// the main reason the dashboard couldn't paint quickly for an established
// account. Cursor-based (not offset) since the list is live/growing -
// `nextCursor` is the last returned video's id, `null` once there's nothing
// more to page through, same "null means done, not zero" convention used
// throughout this file (e.g. highlightScore).
export interface PaginatedVideos {
  videos: VideoWithClips[];
  nextCursor: string | null;
}

// Dashboard Improvement Sprint Phase B ("View All" video processing
// history) - deliberately a lean row shape, not VideoWithClips/
// PaginatedVideos, which drag every AI-feature JSON blob and publishRecord
// per clip across the wire for what a history table only ever renders as a
// title/badge/number. "Cancelled" has no VideoHistoryStatusFilter value -
// VideoStatus has no such state.
export type VideoHistoryStatusFilter = 'COMPLETED' | 'RUNNING' | 'FAILED';
export type VideoHistorySortBy = 'newest' | 'oldest' | 'processingTime' | 'topScore';

export interface VideoHistoryRow {
  id: string;
  title: string | null;
  status: VideoStatus;
  createdAt: string;
  ownerId: string;
  workspaceId: string;
  // Same first->last VideoStatusEvent span as DashboardService.getStats'
  // avgProcessingTimeSeconds calc - null unless status is RENDERED/FAILED
  // and there are >=2 status events.
  processingTimeSeconds: number | null;
  // Highest Clip.viralityScore among this video's clips - null with 0 clips.
  topClipScore: number | null;
  clipCount: number;
}

// sortBy newest/oldest use true keyset cursor pagination (nextCursor set,
// page/totalPages/totalCount null); sortBy processingTime/topScore use
// page-number pagination instead (nextCursor null, page/totalPages/
// totalCount set) - see VideosService.findHistory for why these two modes
// can't share one pagination mechanism.
export interface VideoHistoryPage {
  videos: VideoHistoryRow[];
  sortBy: VideoHistorySortBy;
  nextCursor: string | null;
  page: number | null;
  totalPages: number | null;
  totalCount: number | null;
}

// PATCH /clips/:id payload - manual trim from the timeline editor. Partial:
// either field can be adjusted independently.
export interface UpdateClipInput {
  startTime?: number;
  endTime?: number;
  captionStyle?: CaptionStyle;
  speakerColorCaptions?: boolean;
  // AI Intelligence v4 Track B, Phase A2 - same orthogonal-to-captionStyle
  // shape as speakerColorCaptions above.
  smartSegmentation?: boolean;
  // AI Intelligence v4 Track B, Phase B2 - same orthogonal-to-captionStyle
  // shape as smartSegmentation above.
  dynamicCaptions?: boolean;
  // null clears back to the original (untranslated) text - distinct from
  // omitted (leave unchanged), same convention as MoveVideoDto's
  // projectId/folderId.
  captionLanguage?: string | null;
  // Subtitle Presets roadmap (P3b) - per-clip override of the resolved
  // caption font; null clears it back to Brand Kit resolution, same
  // omitted-vs-null convention as captionLanguage above.
  fontFamily?: string | null;
  // Watermark roadmap (P3c) - per-clip on/off gate, same shape as
  // applyBrandKit; plain boolean, no omitted-vs-null distinction needed.
  watermarkEnabled?: boolean;
  // Intro roadmap (P3d) - per-clip on/off gate, same shape as
  // watermarkEnabled.
  introEnabled?: boolean;
  // Outro roadmap (P3e) - same shape as introEnabled.
  outroEnabled?: boolean;
  hookText?: string;
  hashtags?: string[];
}
