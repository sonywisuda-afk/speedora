import { z } from 'zod';
import { audioFeaturesSchema } from './audio-intelligence';
import { transcriptWordSchema } from './transcript-word';

// AI Intelligence v4, Phase 1 (Hook Prediction Engine) - see
// docs/ai/intelligence-v4.md for the full ADR. Predicts whether a clip's
// OPENING actually hooks a scrolling viewer - a different question from
// clip-scoring's existing `hookStrength` (one impression among 9 unrelated
// dimensions scored in a single candidate-selection call, see
// packages/contracts/src/clip-scoring.ts) and from the Fusion Engine's
// `highlightScore` (a whole-clip "interestingness" blend, see
// packages/fusion-engine). This module sits ALONGSIDE both, consuming
// existing signals rather than replacing them (ADR D1/D5):
// - AudioFeatures (already computed, @speedora/audio-intelligence)
// - a dominant speaker's confidence, reduced from SpeakerConfidenceScore the
//   same "dominantSpeakerX" way speakerFusionFeaturesSchema already does
//   (packages/contracts/src/speaker-scoring.ts)
// - a new pause-timing feature reusing @speedora/cutlist's silence-gap math
//   (packages/hook-prediction's derive-pause-features.ts)
// - one genuinely NEW LLM reasoning step (hookLinguisticFeaturesSchema below)
//   for the dimensions nothing in this codebase computes yet: sentiment,
//   surprise, controversy, keyword rarity, topic shift, question density,
//   numeric facts, named entities.
//
// "Scale honesty" (docs/coding-standards.md): every numeric output below is a
// documented HEURISTIC, not a trained/calibrated prediction - production has
// 0 usable engagement samples to validate any of this against yet (see
// docs/ai/dataset-feedback-loop.md). Never present these as ML-model output
// downstream (UI copy, API docs) without this caveat.

// Deliberately narrower than the full TranscriptSegment shape (no id,
// speaker, rmsDb/peakDb/speakingRateWordsPerSecond - those are folded into
// audioFeaturesSchema separately) - same "adapter narrows DB row into the
// module's own input" convention as audioSegmentSampleSchema.
export const hookPredictionSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  // Vocal (acoustic) emotion label already captured on TranscriptSegment at
  // transcribe time (packages/shared's TranscriptSegment.emotion - one of
  // 'neu'|'hap'|'ang'|'sad') - passed through as extra LLM context rather
  // than re-derived here. Null when detection never ran for this segment.
  emotion: z.string().nullable(),
  words: z.array(transcriptWordSchema).nullable(),
});
export type HookPredictionSegment = z.infer<typeof hookPredictionSegmentSchema>;

export const hookPauseFeaturesSchema = z.object({
  pauseCount: z.number().int().nonnegative(),
  longestPauseSeconds: z.number().nonnegative(),
  // Ratio (0-1) of the clip's total pause time landing within the first
  // HOOK_WINDOW_SECONDS of the clip (see compute-hook-prediction.ts) - a
  // deliberate pre-hook beat ("...") reads differently from mid-clip dead
  // air, not just "some pausing happened somewhere."
  pauseBeforeHookRatio: z.number().min(0).max(1),
});
export type HookPauseFeatures = z.infer<typeof hookPauseFeaturesSchema>;

export const hookPredictionInputSchema = z.object({
  clipId: z.string(),
  segments: z.array(hookPredictionSegmentSchema),
  audioFeatures: audioFeaturesSchema,
  pauseFeatures: hookPauseFeaturesSchema,
  // Reduced the same "dominant speaker" way speakerFusionFeaturesSchema's
  // dominantSpeakerConfidence already is - null when no speaker score exists
  // for this clip (e.g. speakerTimeline itself was null).
  dominantSpeakerConfidence: z.number().min(0).max(1).nullable(),
});
export type HookPredictionInput = z.infer<typeof hookPredictionInputSchema>;

export const HOOK_SENTIMENTS = ['positive', 'negative', 'neutral', 'mixed'] as const;
export type HookSentiment = (typeof HOOK_SENTIMENTS)[number];

// The one genuinely new signal this module adds - an LLM reasoning pass over
// the transcript for dimensions no detector in this codebase produces today.
// See packages/hook-prediction's extract-linguistic-features.ts.
export const hookLinguisticFeaturesSchema = z.object({
  sentiment: z.enum(HOOK_SENTIMENTS),
  dominantEmotion: z.string(),
  surpriseScore: z.number().min(0).max(1),
  controversyScore: z.number().min(0).max(1),
  keywordRarityScore: z.number().min(0).max(1),
  topicShiftScore: z.number().min(0).max(1),
  questionDensity: z.number().min(0).max(1),
  numericFactCount: z.number().int().nonnegative(),
  namedEntities: z.array(z.string()),
});
export type HookLinguisticFeatures = z.infer<typeof hookLinguisticFeaturesSchema>;

export const hookPredictionOutputSchema = z.object({
  clipId: z.string(),
  // 0-100 - HEURISTIC estimate of how likely this clip's opening stops a
  // scrolling viewer. Not a calibrated/trained probability (see module doc
  // comment above).
  hookProbability: z.number().min(0).max(100),
  // Human-readable explanation, same "written for a human, not a log
  // message" convention as clip-scoring's own `reason` field.
  reason: z.string(),
  // CODE-COMPUTED coverage confidence, not an LLM self-report and not a
  // measure of accuracy: fraction of this module's configured signal
  // weight actually backed by non-null input data (0 when nothing was
  // available, 1 when every signal was present) - see
  // compute-hook-prediction.ts. Same "kind of confidence" as
  // ViralityPrediction.confidence (packages/contracts/src/virality-engine.ts),
  // unlike SemanticEvent.confidence/NarrativeSegment.confidence, which are
  // LLM-self-reported certainty about a categorical judgment. Full taxonomy:
  // docs/ai/intelligence-v4.md's "Phase 8 architecture (as shipped)" section.
  confidence: z.number().min(0).max(1),
  linguisticFeatures: hookLinguisticFeaturesSchema,
  predictionFeatures: z.object({
    // HEURISTIC estimate (0-1) - NOT a real observed scroll-stop rate; no
    // engagement dataset exists yet to calibrate this against (ADR D4).
    expectedScrollStopRate: z.number().min(0).max(1),
    // HEURISTIC estimate (-1 to 1) - signed because a weak hook can predict
    // a retention DROP relative to this clip's own highlightScore-implied
    // baseline, not just a lift.
    expectedRetentionLift: z.number().min(-1).max(1),
    expectedReplayPotential: z.number().min(0).max(1),
  }),
});
export type HookPredictionOutput = z.infer<typeof hookPredictionOutputSchema>;
