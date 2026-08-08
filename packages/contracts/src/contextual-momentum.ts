import { z } from 'zod';
import { narrativeGraphSchema } from './narrative-graph';
import { cameraMotionSampleSchema, motionEnergySampleSchema } from './scene-intelligence';

// AI Intelligence v4, Phase 4 (Contextual Momentum - see docs/ai/
// intelligence-v4.md). A new sub-decomposition of spec Part 5 (Retention
// Curve Prediction) - the "is this clip building toward something" timeline
// signal, paired later with Emotional Arc (Phase 5, not built yet) to
// eventually fulfill Part 5's full output. Architecturally different from
// Phases 1-3: NO LLM call - a pure composition over already-computed
// signals, same "composite, not a fresh detector" pattern
// @speedora/editing-rhythm and @speedora/composition-intelligence already
// established. Every numeric field is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no engagement data exists to
// calibrate against. Never present these as ML-model output downstream (UI
// copy, API docs) without this caveat. No confidence field: a pure derive
// with no natural weighted-budget/coverage concept the way Phase 1/7 have
// (docs/ai/intelligence-v4.md's "Phase 8 architecture (as shipped)" section).

// A per-instant timeline (array), same convention as motionEnergy/
// semanticEvents - not a single per-clip object like hookPrediction/
// narrativeGraph.
export const momentumSampleSchema = z.object({
  // Clip-relative seconds - reuses motionEnergySamples' own sampling grid
  // rather than inventing a new cadence.
  t: z.number(),
  // 0-1, RELATIVE within this clip's own samples only - not comparable
  // across clips (same caveat as the raw motionEnergy/cameraMotion signals
  // it's built from).
  momentumScore: z.number().min(0).max(1),
});
export type MomentumSample = z.infer<typeof momentumSampleSchema>;

export const momentumCurveSchema = z.array(momentumSampleSchema);
export type MomentumCurve = z.infer<typeof momentumCurveSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own. cameraMotionSamples/accelerationScore/
// narrativeGraph are all independently optional upstream signals that
// degrade gracefully to a neutral contribution when absent, same "optional
// context, never a hard dependency" pattern Phase 3 used for semanticEvents.
export const computeMomentumCurveInputSchema = z.object({
  clipDurationSeconds: z.number().nonnegative(),
  motionEnergySamples: z.array(motionEnergySampleSchema),
  cameraMotionSamples: z.array(cameraMotionSampleSchema).nullable(),
  accelerationScore: z.number().min(-1).max(1).nullable(),
  narrativeGraph: narrativeGraphSchema.nullable(),
});
export type ComputeMomentumCurveInput = z.infer<typeof computeMomentumCurveInputSchema>;
