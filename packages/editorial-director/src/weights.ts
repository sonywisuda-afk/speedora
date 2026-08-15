import type { EditorialCategory, NegativeSignalType } from '@speedora/contracts';

// HEURISTIC, hand-authored (ADR D4, docs/coding-standards.md's "scale
// honesty") - real ML calibration is blocked on the same 0-usable-production
// -engagement-samples constraint every other phase in this roadmap already
// documents (see docs/ai/dataset-validation-calibration.md). The STRUCTURAL
// fix Editorial Director Phase A makes is composing a smaller set of named
// categories instead of averaging @speedora/clip-ranking's 13 correlated raw
// sub-scores (see docs/ai/clip-ranking-engine.md's own double-counting
// finding, and docs/ai/editorial-director.md) - not a claim that these
// specific numbers are correct. Re-run against real engagement data once it
// exists, same "collect first, calibrate later" precedent @speedora/
// fusion-engine's own weights.ts already established.

// Category weights are relative shares, re-normalized at call time
// (compose-editorial-score.ts) over whichever categories are non-null for
// the mode - same "average of non-null" convention @speedora/clip-ranking's
// own compositeScore already uses. visualEngagement/speakerClarity are 0 in
// shortlist mode (no editingSuggestions/conversation data exists pre-render
// - see docs/ai/editorial-director.md's own open-question note on why
// shortlist-mode speakerClarity was deferred rather than bundled in).
export const SHORTLIST_CATEGORY_WEIGHTS: Record<EditorialCategory, number> = {
  contentValue: 0.2,
  hookStrength: 0.2,
  narrativeCompleteness: 0.2,
  contextCompleteness: 0.15,
  emotionalPayoff: 0.15,
  visualEngagement: 0,
  speakerClarity: 0,
  platformFit: 0.1,
};

export const RENDER_CATEGORY_WEIGHTS: Record<EditorialCategory, number> = {
  contentValue: 0.15,
  hookStrength: 0.15,
  narrativeCompleteness: 0.15,
  contextCompleteness: 0.1,
  emotionalPayoff: 0.1,
  visualEngagement: 0.1,
  speakerClarity: 0.1,
  platformFit: 0.15,
};

// Each negative signal's own maximum contribution (points deducted from the
// weighted category composite), independently capped so no single detector
// can dominate editorialScore on its own. Deliberately NOT required to sum
// to MAX_TOTAL_PENALTY below - a clip tripping several signals at once
// should still be capped in total, not zeroed out purely by stacking every
// possible penalty (see composeEditorialScore()).
export const PENALTY_CAPS: Record<NegativeSignalType, number> = {
  contextDependency: 24,
  redundancy: 20,
  deadAir: 15,
  confusion: 15,
  incompleteThought: 15,
  abruptEnding: 15,
  setupTooLong: 12,
  payoffMissing: 15,
  visualInstability: 15,
  overEditingRisk: 12,
};

// Total penalty deduction cap, applied once in composeEditorialScore() after
// summing every triggered negativeSignals[].penalty - keeps a clip that
// trips several negative signals reading as "meaningfully worse," not
// "impossible" (editorialScore can still reach 0 via a genuinely low
// category composite, just not purely from penalty stacking).
export const MAX_TOTAL_PENALTY = 40;

// Candidate Diversity (mission Section 8) - compute-candidate-similarity.ts.
// A cheap heuristic (keyword/n-gram Jaccard + semantic-event-type overlap),
// NOT real embeddings - a user-confirmed scope decision for Phase A (no new
// external dependency this phase, see docs/ai/editorial-director.md).
export const TEXT_SIMILARITY_WEIGHT = 0.5;
export const SEMANTIC_EVENT_SIMILARITY_WEIGHT = 0.5;
// Two candidates at or above this combined similarity, at non-overlapping
// timestamps, are treated as near-duplicate TOPICS - true time-range
// overlaps are already handled upstream by @speedora/clip-scoring's own
// deduplicateOverlappingCandidates.
export const REDUNDANCY_THRESHOLD = 0.5;
