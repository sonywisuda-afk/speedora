import type { PublishRecord } from './social';

export enum VideoStatus {
  // Only reachable via POST /videos/import-youtube - a direct file upload
  // (POST /videos) goes straight to UPLOADED since the file is already in
  // hand. IMPORTING covers the time apps/worker's import-youtube job spends
  // downloading the source video before it has a real sourceUrl to store.
  IMPORTING = 'IMPORTING',
  UPLOADED = 'UPLOADED',
  TRANSCRIBED = 'TRANSCRIBED',
  CLIPS_DETECTED = 'CLIPS_DETECTED',
  RENDERED = 'RENDERED',
  FAILED = 'FAILED',
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
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
  createdAt: string;
  updatedAt: string;
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
  captionStyle: CaptionStyle;
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
  // Publish attempts to connected social accounts (Fase 6b) - empty until
  // the user hits "Publish now" at least once. Small array in practice (at
  // most one per connected platform account), so returned inline rather
  // than via a separate endpoint.
  publishRecords: PublishRecord[];
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

// PATCH /clips/:id payload - manual trim from the timeline editor. Partial:
// either field can be adjusted independently.
export interface UpdateClipInput {
  startTime?: number;
  endTime?: number;
  captionStyle?: CaptionStyle;
  hookText?: string;
  hashtags?: string[];
}
