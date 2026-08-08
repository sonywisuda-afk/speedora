import { z } from 'zod';
import { emotionalArcSampleSchema } from './emotional-arc';
import { hookPredictionOutputSchema } from './hook-prediction';
import { momentumSampleSchema } from './contextual-momentum';
import { narrativeGraphSchema } from './narrative-graph';

// AI Intelligence v4, Phase 7 (Cross-module Fusion, spec Part 4 - Virality
// Engine - see docs/ai/intelligence-v4.md), REALIGNED in Phase 9 once the
// real Part 4 spec text became available. Phase 7 shipped by reverse-
// engineering what "Virality Engine" wanted (no spec text existed in the
// repo at the time) - it produced 8 structural sub-probabilities
// (hookStrength/replayPotential/buildIntensity/peakMomentum/
// emotionalIntensity/emotionalRange/narrativeCompleteness/payoffPresence).
// Phase 9 REPLACES that shape with the spec's own 7 named probabilities
// below, per ADR D12 (docs/ai/intelligence-v4.md's Parts 4-15 re-audit) -
// the one deliberate exception to this initiative's strict additive-only
// convention, justified because VIRALITY_ENGINE_ENABLED is false in
// production (zero real consumers of the old shape existed to break).
//
// "Cross-module Fusion" still means fusing v4's OWN already-computed
// outputs (Phases 1/3/4/5), not detecting anything new - same zero-LLM
// shape as Phase 4/5/6, same 4 dependencies Phase 7 already had (no new
// render-graph wiring in Phase 9). NEVER touches Fusion Engine v2 (ADR D1)
// - "cross-module" is scoped to v4's own modules only, never
// FUSION_INPUT_MAP/computeHighlightScore.
//
// NAMING: this is deliberately NOT called `virality` bare, to avoid
// confusion with the pre-existing, unrelated `Clip.viralityScore` (Fase 8's
// original MVP LLM clip-scoring - a single 0-100 number used to SELECT
// candidate moments before a clip is even rendered; see docs/ai/scoring.md,
// which documents this as the 4th of 4 distinct scoring systems in this
// codebase). `Clip.viralityPrediction` here is a JSON breakdown of 7
// heuristic probabilities computed AFTER render by fusing already-computed
// v4 signals - an entirely different computation path. Do not conflate the
// two.
//
// Every numeric field below is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no engagement data exists to
// calibrate against. Never present these as ML-model output downstream (UI
// copy, API docs) without this caveat.

// A single per-clip object (like HookPredictionOutput), not a per-instant
// timeline like MomentumCurve/EmotionalArc. Exactly the 7 probabilities the
// real Part 4 spec names, each re-composed from Phases 1/3/4/5's own
// already-computed outputs (no new detector) - each null (not 0) when its
// source data is genuinely unavailable, same "null means unavailable, not a
// fabricated 0" convention Phase 6's averageMomentumScore/peakMomentumScore
// already established.
export const viralitySubProbabilitiesSchema = z.object({
  // Direct reuse of Phase 1's own expectedScrollStopRate - already named
  // almost identically to the spec's ask. Null when hookPrediction is null.
  scrollStopProbability: z.number().min(0).max(1).nullable(),
  // Blend of sustained momentumCurve energy, Phase 1's expectedRetentionLift
  // (normalized from its own -1..1 range), and narrativeGraph segment-type
  // coverage - "will they keep watching through the middle." Null only when
  // all three sources are unavailable.
  watchProbability: z.number().min(0).max(1).nullable(),
  // Reuses the same isPayoffSegmentType/`resolves`-relation check Phase
  // 7's own payoffPresence used, plus a late-momentum-not-collapsing check
  // over the final third of momentumCurve. Null when narrativeGraph is
  // unusable AND momentumCurve is empty.
  completionProbability: z.number().min(0).max(1).nullable(),
  // Phase 1's surpriseScore/controversyScore (surprising/controversial
  // content gets shared) blended with emotionalArc's peak intensity. Null
  // when hookPrediction is null AND emotionalArc is empty.
  shareProbability: z.number().min(0).max(1).nullable(),
  // Phase 1's controversyScore/questionDensity (open questions and
  // controversial claims invite comments) blended with an "unresolved
  // tension" check (narrativeGraph has conflict/escalation segments but no
  // `resolves` relation). Null when hookPrediction is null AND
  // narrativeGraph is unusable.
  commentProbability: z.number().min(0).max(1).nullable(),
  // Phase 1's numericFactCount/namedEntities.length (concrete, reference-
  // able facts are save-worthy) blended with a `takeaway`-segment-type
  // bonus from narrativeGraph. Null when hookPrediction is null AND
  // narrativeGraph is unusable.
  saveProbability: z.number().min(0).max(1).nullable(),
  // The WEAKEST-SUPPORTED dimension of the 7 - no speaker-trust signal is
  // wired into this phase's inputs (Speaker Scoring is not one of the 4
  // dependencies), so this is only a rough proxy from Phase 1's
  // dominantEmotion positivity and emotionalArc's ratio of 'hap' samples.
  // A future phase could strengthen this with Speaker Scoring's
  // confidence/engagement signals - not scoped here. Null when both
  // sources are unavailable.
  followProbability: z.number().min(0).max(1).nullable(),
});
export type ViralitySubProbabilities = z.infer<typeof viralitySubProbabilitiesSchema>;

export const viralityPredictionSchema = z.object({
  clipId: z.string(),
  // Composite - the average of every non-null probability above. Null
  // only when ALL 7 are null (none of the 4 dependency phases had any
  // usable data for this clip) - a real, honest result, not a fabricated
  // 0.5. Named to match the spec's own "Overall Viral Score" (Phase 7's
  // `viralityProbability` field name is retired in this realignment).
  overallViralScore: z.number().min(0).max(1).nullable(),
  // CODE-COMPUTED coverage confidence, not an LLM self-report and not a
  // measure of accuracy: count(non-null probabilities) / 7 (was /8 before
  // Phase 9's realignment). Same "kind of confidence" as
  // HookPredictionOutput.confidence, unlike
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
