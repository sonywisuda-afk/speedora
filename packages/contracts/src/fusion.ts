import { z } from 'zod';
import { audioFeaturesSchema } from './audio-intelligence';
import { clipScoresSchema } from './clip-scoring';
import { editingRhythmFeaturesSchema } from './editing-rhythm';
import { faceLandmarkFeaturesSchema } from './face-landmarks';
import { facialEmotionFeaturesSchema } from './facial-intelligence';
import { gestureFeaturesSchema } from './gesture-intelligence';
import { objectFeaturesSchema } from './object-intelligence';
import { ocrFeaturesSchema } from './ocr';
import {
  cameraMotionFeaturesSchema,
  motionEnergyFeaturesSchema,
  sceneFeaturesSchema,
} from './scene-intelligence';
import { speakerFusionFeaturesSchema } from './speaker-scoring';

// Defined ahead of the modules that produce every input (per explicit user
// direction) - every signal module built from here on (Eye Contact, Visual
// Intelligence, OCR, LLM/semantic) is expected to plug its own `features`
// object into this contract as an additional optional field, the same way
// audio/scene/facial/gesture already do below. Checkpoints EXTEND this
// contract and the engine that reads it (packages/fusion-engine), they
// never replace either.
//
// v2 (Fase 31) - revised per explicit user architectural direction after
// v1 (Fase 29) shipped: (1) weighted, not averaged, scoring so each
// signal's contribution is independently tunable and later optimizable
// against real engagement data (Checkpoint 5 in the roadmap diagram);
// (2) `confidence` and structured `explainability` as first-class output,
// not just a single opaque number + one sentence; (3) FEATURE-level fusion
// - the engine extracts/normalizes/weights individual named features
// (e.g. audio's averageRmsDb AND speakingRateStdDev separately), not one
// pre-collapsed per-module score - so adding a new module later contributes
// richer information without any existing detail being lost.
// `faceGeometry` (AI Fusion roadmap's Face Intelligence initiative, Batch 1) -
// blink/smile/mouth-open/head-rotation/framing signals from MediaPipe's
// FaceLandmarker, distinct from `facial` (expression classification via a
// separate ViT model) - the two run as separate subprocess calls producing
// unrelated feature sets, so they're separate signals here too, not folded
// together.
// `sceneMotion` (Scene Intelligence taxonomy expansion, Batch SC-2) -
// motion-energy/static-dynamic classification, a SEPARATE signal from
// `scene`'s cut-based features: a clip can be one continuous shot (zero
// cuts) yet still be highly dynamic, or full of cuts between static shots.
// Deliberately its own signal rather than folded into `scene`'s features -
// `scene` already carries a real, non-zero weight (30%, see weights.ts), so
// adding an uncalibrated new feature into it would immediately shift every
// existing clip's highlightScore with no data backing the change. Same
// "weight 0 until calibrated" treatment as gesture/faceGeometry below.
// `cameraMotion` (Scene Intelligence taxonomy expansion, Batch SC-3) -
// directional camera motion (pan/tilt/zoom/shake), a SEPARATE signal from
// `sceneMotion`'s magnitude-only measurement above - same "collected, weight
// 0 until calibrated" treatment, per explicit user direction: wire it into
// the pipeline now, gather real data, evaluate the distribution, THEN
// calibrate before it's allowed to move highlightScore.
// `editingRhythm` (taxonomy category F, requested by user after Scene
// Intelligence Batch SC-3) - a COMPOSITE signal, not a raw detector: its
// own module (@speedora/editing-rhythm) combines OTHER signals'
// already-computed output (scene/sceneMotion/audio) into tempoScore/
// pacingScore/accelerationScore. Per explicit user architectural rule:
// composite/derived signals like this one get their own package and are
// wired into the Fusion Engine exactly like a raw-detection signal -
// weight 0 until calibrated, same "collect first, calibrate later"
// treatment as sceneMotion/cameraMotion/gesture/faceGeometry. The Fusion
// Engine itself never derives new features - it only ever combines/weighs
// whatever `*Features` objects already exist.
//
// `speaker` (Speaker Intelligence roadmap, Milestone D) - another
// COMPOSITE signal, same treatment as editingRhythm: its own package
// (@speedora/speaker-scoring) combines diarization/face-tracking/audio/
// gesture output (already consumed individually by the signals above)
// into dominantSpeakerConfidence/Engagement/Importance +
// averageSpeakerHighlightScore. Wired in at weight 0 (see weights.ts) -
// same "collect first, calibrate later" reasoning, this time actually
// backed by real per-clip detectors (Milestones A-C), unlike the
// speakerFusionFeaturesSchema draft this replaced (see that schema's own
// comment for what was cut for having no implementation at all).
// `object` (Object Intelligence roadmap, Batch OI-1) - same "collect first,
// calibrate later" treatment as sceneMotion/cameraMotion/gesture/
// faceGeometry: @speedora/object-intelligence's deriveObjectFeatures()
// output is collected and visible in `contributions`, but weight 0 (see
// weights.ts) until there's real engagement data to calibrate against.
export const FUSION_SIGNALS = [
  'audio',
  'scene',
  'sceneMotion',
  'cameraMotion',
  'editingRhythm',
  'facial',
  'gesture',
  'faceGeometry',
  'ocr',
  'object',
  'llm',
  'speaker',
] as const;
export type FusionSignal = (typeof FUSION_SIGNALS)[number];

// Each field is `.optional()` (not required) because a clip may be missing
// one or more signals entirely (analysis not run for that phase yet, or it
// failed - see each module's own "never fails the job" adapter handling) -
// the Fusion Engine must degrade gracefully with partial input rather than
// require every signal to be present, same "optional signal" philosophy
// that already governs every individual module in this pipeline.
//
// `ocr` (AI Fusion roadmap's OCR initiative, Batch OCR-2) - reserved as a
// weight-table-only key since Fase 31 (see weights.ts's own comment); this
// is the batch that finally gives it a real fusionInputSchema field,
// consuming @speedora/ocr-intelligence's deriveOcrFeatures() output the
// same way every other signal here consumes its own module's *Features.
//
// `llm` (Fase 32) reuses clip-scoring's own ClipScores directly - it's
// already a per-clip "Features"-shaped object (9 named 0-100 metrics
// grouped into Engagement/Knowledge/Conversion domains, see clip-scoring's
// SCORE_DOMAINS), computed once at detect-clips time rather than at
// render-clip time like every other signal here, but consumed the same way.
export const fusionInputSchema = z.object({
  clipId: z.string(),
  audio: audioFeaturesSchema.optional(),
  scene: sceneFeaturesSchema.optional(),
  sceneMotion: motionEnergyFeaturesSchema.optional(),
  cameraMotion: cameraMotionFeaturesSchema.optional(),
  editingRhythm: editingRhythmFeaturesSchema.optional(),
  facial: facialEmotionFeaturesSchema.optional(),
  gesture: gestureFeaturesSchema.optional(),
  faceGeometry: faceLandmarkFeaturesSchema.optional(),
  ocr: ocrFeaturesSchema.optional(),
  object: objectFeaturesSchema.optional(),
  llm: clipScoresSchema.optional(),
  speaker: speakerFusionFeaturesSchema.optional(),
});

// Per-signal weight table - the "Feature Weighting" pipeline stage's
// configuration, injectable (not hardcoded forever) so Checkpoint 5's
// planned weight optimization against real engagement data can override
// it without touching engine code. Partial - a signal with no entry (or an
// entry of 0) contributes 0 to highlightScore but its features are still
// extracted/normalized/reported in `contributions` for transparency, never
// silently dropped.
export const fusionWeightsSchema = z.record(z.enum(FUSION_SIGNALS), z.number().min(0));
export type FusionWeights = Partial<Record<FusionSignal, number>>;

// One individual named feature's full journey through the pipeline -
// "feature-level fusion, not just per-module scores": every extracted
// feature is reported here, not collapsed into one opaque per-signal
// number. `rawValue` null means the feature was extracted as a category
// (e.g. a dominant emotion/gesture weight) rather than a raw measurement.
export const fusionContributionSchema = z.object({
  signal: z.enum(FUSION_SIGNALS),
  feature: z.string(),
  rawValue: z.number().nullable(),
  // Normalized to a common [0, 1] scale - the "Feature Normalization" stage.
  normalizedValue: z.number().min(0).max(1),
  // This feature's share of its signal's total weight (a signal's weight is
  // split evenly across however many of its own features are actually
  // present - see packages/fusion-engine's weightFeatures()).
  weight: z.number().min(0),
  weightedContribution: z.number(),
});

export const fusionFactorSchema = z.object({
  signal: z.enum(FUSION_SIGNALS),
  feature: z.string(),
  weightedContribution: z.number(),
  description: z.string(),
});

// Structured "why" - not just a sentence. `topFactors` are the highest-
// magnitude contributions, letting a caller build its own UI/explanation
// rather than being stuck with one fixed English sentence.
export const fusionExplainabilitySchema = z.object({
  topFactors: z.array(fusionFactorSchema),
});

// Prediction stage (Fase 32) - a coarse, deterministic bucket derived from
// highlightScore + confidence, NOT a statistically calibrated forecast -
// same "heuristic, not a trained model" honesty as every other number this
// engine produces. Exists so a caller gets a plain-language read
// ("likely_high_performer") without having to invent its own thresholds on
// highlightScore/confidence itself.
export const PREDICTION_BUCKETS = [
  'likely_high_performer',
  'uncertain',
  'likely_low_performer',
] as const;
export type PredictionBucket = (typeof PREDICTION_BUCKETS)[number];

export const fusionPredictionSchema = z.object({
  bucket: z.enum(PREDICTION_BUCKETS),
  rationale: z.string(),
});

// Recommendation stage (Fase 32) - one concrete, actionable next step,
// derived from the prediction bucket and (for a low-performing clip) the
// single weakest weighted contribution - turning the score into "what
// should I actually do about it" rather than leaving the caller to
// interpret a number.
export const fusionRecommendationSchema = z.object({
  action: z.string(),
  message: z.string(),
});

export const fusionOutputSchema = z.object({
  clipId: z.string(),
  // Combined 0-100 score across every WEIGHTED signal that was available -
  // null when the sum of available weights is 0 (nothing with a non-zero
  // weight was available to combine), not a fabricated 0/50.
  highlightScore: z.number().min(0).max(100).nullable(),
  // How much of the theoretically-available weight actually had data,
  // blended with any explicit per-sample confidence signals (e.g. facial/
  // gesture peakConfidence) that were present - 1 means "every weighted
  // signal was present and highly confident," not a claim about accuracy
  // against real engagement.
  confidence: z.number().min(0).max(1),
  contributions: z.array(fusionContributionSchema),
  explainability: fusionExplainabilitySchema,
  // Human-readable sentence built from `explainability.topFactors` - kept
  // for the same "never just an opaque number" reason Fase 8's `reason`
  // was introduced, now with structured data backing it up too.
  reason: z.string(),
  prediction: fusionPredictionSchema,
  recommendation: fusionRecommendationSchema,
});

// Ranking stage - a clip's score only really means something relative to
// its siblings in the same video (the whole point of this pipeline is
// picking the BEST moments). Deliberately a separate, tiny pure function
// contract (not folded into fusionOutputSchema) - it operates on a batch of
// already-scored clips, a different shape/lifecycle than scoring one clip
// in isolation.
export const rankedClipSchema = z.object({
  clipId: z.string(),
  highlightScore: z.number().min(0).max(100).nullable(),
  // 1 = highest score. Clips with a null highlightScore are ranked last,
  // ordered arbitrarily (stable by input order) among themselves.
  rank: z.number().int().positive(),
});

export type FusionInput = z.infer<typeof fusionInputSchema>;
export type FusionContribution = z.infer<typeof fusionContributionSchema>;
export type FusionFactor = z.infer<typeof fusionFactorSchema>;
export type FusionExplainability = z.infer<typeof fusionExplainabilitySchema>;
export type FusionPrediction = z.infer<typeof fusionPredictionSchema>;
export type FusionRecommendation = z.infer<typeof fusionRecommendationSchema>;
export type FusionOutput = z.infer<typeof fusionOutputSchema>;
export type RankedClip = z.infer<typeof rankedClipSchema>;
