// HEURISTIC, hand-authored (ADR D4, docs/coding-standards.md's "scale honesty") - no production
// engagement data exists yet to validate whether this composite even correlates with anything
// worth acting on (same 0-usable-samples blocker every other phase in this roadmap already
// documents). Real calibration is a future phase's job, once real data exists to justify it -
// this file exists so that phase has one place to update, same "collect first, calibrate later"
// precedent every other weights.ts in this codebase already established.

// A 'measured' dimension (a real signal that measures what its name claims) counts fully toward
// compositeScore/confidence; a 'proxy' dimension (a real signal that measures something adjacent,
// see render-quality-judge.ts's own basis doc comment) counts at half trust - present, but not
// treated as equivalent evidence. 'unavailable' dimensions are excluded entirely (weight 0), never
// coerced to a fabricated score.
export const MEASURED_WEIGHT = 1;
export const PROXY_WEIGHT = 0.5;

// derive-technical-quality.ts's own penalty scale.
export const STREAM_MISSING_PENALTY = 60;
export const AUDIO_MISSING_PENALTY = 20;
export const VERIFICATION_MISMATCH_PENALTY = 30;
export const MAX_DURATION_DRIFT_PENALTY = 30;
// A drift at or beyond this fraction of the requested duration saturates
// MAX_DURATION_DRIFT_PENALTY - deliberately generous given verifyRenderedDuration() already
// tolerates several small, EXPECTED deltas (trim cuts, reaction holds, intro/outro) that this
// dimension has no per-cause visibility into, only the net result.
export const FULL_DRIFT_PENALTY_FRACTION = 0.2;

// derive-visual-quality.ts's own proxy penalty for a co-occurring visualInstability negative
// signal (Editorial Director Phase A) - a real, deliberate cross-phase integration point, not a
// second independent instability detector.
export const VISUAL_INSTABILITY_PROXY_PENALTY = 20;
