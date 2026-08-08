import { z } from 'zod';
import { emotionalArcSampleSchema } from './emotional-arc';
import { momentumSampleSchema } from './contextual-momentum';
import { semanticEventSchema } from './semantic-events';

// AI Intelligence v4, Phase 10 (Retention Curve Insights, spec Part 5
// extension - see docs/ai/intelligence-v4.md). Phase 4 (Contextual
// Momentum) and Phase 5 (Emotional Arc) ship the RAW per-instant signals
// (MomentumCurve, EmotionalArc) spec Part 5 ("Retention Curve Prediction")
// needs, but not its actual derived outputs. This phase adds those derived
// outputs as a NEW layer over Phases 4/5's own already-computed arrays
// (ADR D13, docs/ai/intelligence-v4.md's Parts 4-15 re-audit) - unlike
// Phase 9's realignment, this stays strictly additive: MomentumCurve/
// EmotionalArc are NOT modified, only consumed.
//
// Every numeric field below is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no engagement data exists
// to calibrate against. Never present these as ML-model output downstream
// (UI copy, API docs) without this caveat. No confidence field, same
// "pure derive with no natural weighted-budget concept" reasoning Phase
// 4/5/6 already established - coverage is communicated by each array
// being present-but-possibly-empty, not by a separate number.

// A single timestamped signal point - the shared shape for all 4 arrays
// below. `score` is RELATIVE within this clip's own points only, same
// "not comparable across clips" caveat MomentumCurve's momentumScore/
// EmotionalArc's intensity already carry.
export const retentionPointSchema = z.object({
  // Clip-relative seconds.
  t: z.number(),
  score: z.number().min(0).max(1),
});
export type RetentionPoint = z.infer<typeof retentionPointSchema>;

// A single per-clip object (like ViralityPrediction), not itself a
// per-instant timeline - each field IS a timeline (array of
// RetentionPoint), reusing 4 different source signals. Every array can be
// empty (not null) - a real, honest "no such point found" result, same
// convention Phase 6/7's own empty-array/zero cases already use.
export const retentionCurveInsightsSchema = z.object({
  clipId: z.string(),
  // Local minima in MomentumCurve.momentumScore - moments where momentum
  // drops sharply, a likely audience-drop-off signal.
  dropPoints: z.array(retentionPointSchema),
  // Local maxima in MomentumCurve.momentumScore, boosted by nearby
  // EmotionalArc intensity when available - a likely rewatch-worthy
  // moment.
  replayZones: z.array(retentionPointSchema),
  // Local maxima in EmotionalArc.intensity.
  emotionalPeaks: z.array(retentionPointSchema),
  // SemanticEvent[] entries whose type reads as curiosity-evoking (see
  // @speedora/retention-curve-insights' isCuriositySemanticEventType()) -
  // t/score come directly from the event's own t/importance.
  curiosityPeaks: z.array(retentionPointSchema),
});
export type RetentionCurveInsights = z.infer<typeof retentionCurveInsightsSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own. semanticEvents is an independently optional
// upstream signal (Phase 2) that degrades gracefully to an empty
// curiosityPeaks when absent - same "optional context, never a hard
// dependency" pattern Phase 3/4/5 already use for it.
export const computeRetentionCurveInsightsInputSchema = z.object({
  clipId: z.string(),
  momentumCurve: z.array(momentumSampleSchema),
  emotionalArc: z.array(emotionalArcSampleSchema),
  semanticEvents: z.array(semanticEventSchema).nullable(),
});
export type ComputeRetentionCurveInsightsInput = z.infer<
  typeof computeRetentionCurveInsightsInputSchema
>;
