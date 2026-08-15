// HEURISTIC, hand-authored (ADR D4, docs/coding-standards.md's "scale honesty") - informed by
// docs/ai/visual-emphasis-integration-audit.md's real Gate B render measurements, not a claim that
// these specific numbers are the calibrated answer. Real calibration is Gate C's job, blocked on
// real footage (same recurring constraint every other phase in this roadmap already documents) -
// this file exists so Gate C has one place to update once real data exists, same "collect first,
// calibrate later" precedent every other weights.ts in this codebase already established.

// Baseline per-technique caps, calibrated for a representative ~45s clip (this codebase's own
// short-form target range) - scaled by actual clip duration in compute-edit-budget.ts.
export const BASELINE_MAX_FOCUS_SHIFTS = 3;
export const BASELINE_MAX_SPEAKER_FOCUS_SHIFTS = 3;
export const BASELINE_MAX_DIGITAL_PUSH = 3;
export const BASELINE_MAX_OCR_HIGHLIGHTS = 2;
export const BASELINE_MAX_REACTION_HOLDS = 1;

export const BASELINE_CLIP_DURATION_SECONDS = 45;

// Duration scaling is clamped to [0.5x, 2x] - an unbounded linear scale would let a very long clip
// accumulate an unrealistic cap, and a very short one would round every cap to 0.
export const MIN_DURATION_SCALE = 0.5;
export const MAX_DURATION_SCALE = 2;

// Applied when Phase A's own EditorialDecision.negativeSignals already flagged
// visualInstability/overEditingRisk for this clip (see compute-edit-budget.ts) - a real, deliberate
// cross-phase integration point: Edit Budget consumes Phase A's own finding rather than
// re-detecting instability itself.
export const INSTABILITY_BUDGET_MULTIPLIER = 0.5;
