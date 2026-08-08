import { z } from 'zod';
import { emotionalArcSampleSchema } from './emotional-arc';
import { hookPredictionOutputSchema } from './hook-prediction';
import { momentumSampleSchema } from './contextual-momentum';
import { narrativeGraphSchema } from './narrative-graph';

// AI Intelligence v4, Phase 7 (Cross-module Fusion, spec Part 4 - Virality
// Engine - see docs/ai/intelligence-v4.md). "Cross-module Fusion" means
// fusing v4's OWN already-computed outputs (Phases 1/3/4/5), not detecting
// anything new - same zero-LLM shape as Phase 4/5/6. NEVER touches Fusion
// Engine v2 (ADR D1) - "cross-module" is scoped to v4's own modules only,
// never FUSION_INPUT_MAP/computeHighlightScore.
//
// NAMING: this is deliberately NOT called `virality` bare, to avoid
// confusion with the pre-existing, unrelated `Clip.viralityScore` (Fase 8's
// original MVP LLM clip-scoring - a single 0-100 number used to SELECT
// candidate moments before a clip is even rendered; see docs/ai/scoring.md,
// which now documents this as the 4th of 4 distinct scoring systems in this
// codebase). `Clip.viralityPrediction` here is a JSON breakdown of 8
// heuristic sub-probabilities computed AFTER render by fusing already-
// computed v4 signals - an entirely different computation path. Do not
// conflate the two.
//
// Every numeric field below is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no engagement data exists to
// calibrate against. Never present these as ML-model output downstream (UI
// copy, API docs) without this caveat.

// A single per-clip object (like HookPredictionOutput), not a per-instant
// timeline like MomentumCurve/EmotionalArc. Exactly 8 sub-probabilities, 2
// sourced from each of the 4 dependency phases - each null (not 0) when
// its source phase's data is genuinely unavailable, same "null means
// unavailable, not a fabricated 0" convention Phase 6's
// averageMomentumScore/peakMomentumScore already established.
export const viralitySubProbabilitiesSchema = z.object({
  // From Phase 1 (Hook Prediction) - direct transforms of its own output,
  // not re-derived. Null when hookPrediction itself is null (LLM call
  // failed/never ran, or the flag is off - see Phase 1's own null-
  // semantics).
  hookStrength: z.number().min(0).max(1).nullable(),
  replayPotential: z.number().min(0).max(1).nullable(),
  // From Phase 4 (Contextual Momentum). Null when momentumCurve is empty
  // (buildIntensity additionally needs at least 2 samples to compute a
  // trend).
  buildIntensity: z.number().min(0).max(1).nullable(),
  peakMomentum: z.number().min(0).max(1).nullable(),
  // From Phase 5 (Emotional Arc). Null when emotionalArc is empty.
  emotionalIntensity: z.number().min(0).max(1).nullable(),
  emotionalRange: z.number().min(0).max(1).nullable(),
  // From Phase 3 (Narrative Graph). Null when narrativeGraph is null or
  // unsegmented (same "not a real graph" degrade every other Phase 3
  // consumer already uses).
  narrativeCompleteness: z.number().min(0).max(1).nullable(),
  payoffPresence: z.number().min(0).max(1).nullable(),
});
export type ViralitySubProbabilities = z.infer<typeof viralitySubProbabilitiesSchema>;

export const viralityPredictionSchema = z.object({
  clipId: z.string(),
  // Composite - the average of every non-null sub-probability above. Null
  // only when ALL 8 are null (none of the 4 dependency phases had any
  // usable data for this clip) - a real, honest result, not a fabricated
  // 0.5.
  viralityProbability: z.number().min(0).max(1).nullable(),
  // CODE-COMPUTED coverage confidence, not an LLM self-report and not a
  // measure of accuracy: count(non-null sub-probabilities) / 8. Same "kind
  // of confidence" as HookPredictionOutput.confidence, unlike
  // SemanticEvent.confidence/NarrativeSegment.confidence, which are
  // LLM-self-reported certainty about a categorical judgment. Full taxonomy:
  // docs/ai/intelligence-v4.md's "Phase 8 architecture (as shipped)" section.
  confidence: z.number().min(0).max(1),
  // Human-readable explanation, same "written for a human, not a log
  // message" convention as hookPrediction's own `reason` field.
  reason: z.string(),
  subProbabilities: viralitySubProbabilitiesSchema,
});
export type ViralityPrediction = z.infer<typeof viralityPredictionSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own.
export const computeViralityPredictionInputSchema = z.object({
  clipId: z.string(),
  hookPrediction: hookPredictionOutputSchema.nullable(),
  narrativeGraph: narrativeGraphSchema.nullable(),
  momentumCurve: z.array(momentumSampleSchema),
  emotionalArc: z.array(emotionalArcSampleSchema),
});
export type ComputeViralityPredictionInput = z.infer<typeof computeViralityPredictionInputSchema>;
