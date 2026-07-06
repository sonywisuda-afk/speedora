import { z } from 'zod';
import { audioFeaturesSchema } from './audio-intelligence';
import { clipScoresSchema } from './clip-scoring';
import { facialEmotionFeaturesSchema } from './facial-intelligence';
import { gestureFeaturesSchema } from './gesture-intelligence';
import { sceneFeaturesSchema } from './scene-intelligence';

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
export const FUSION_SIGNALS = ['audio', 'scene', 'facial', 'gesture', 'ocr', 'llm'] as const;
export type FusionSignal = (typeof FUSION_SIGNALS)[number];

// Each field is `.optional()` (not required) because a clip may be missing
// one or more signals entirely (analysis not run for that phase yet, or it
// failed - see each module's own "never fails the job" adapter handling) -
// the Fusion Engine must degrade gracefully with partial input rather than
// require every signal to be present, same "optional signal" philosophy
// that already governs every individual module in this pipeline.
//
// `ocr` is NOT present as an input field yet - no module produces OCR
// features (see CLAUDE.md's Fase 24 gap analysis) - it's reserved in
// FUSION_SIGNALS/fusionWeightsSchema below so the weight table and engine
// code don't need to change shape again once that module exists, only
// gain a new optional input field + extraction/normalization case.
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
  facial: facialEmotionFeaturesSchema.optional(),
  gesture: gestureFeaturesSchema.optional(),
  llm: clipScoresSchema.optional(),
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
