import { z } from 'zod';

// Editorial Director Phase A ("Editorial Intelligence 2.0" - see docs/ai/
// editorial-director.md). The user's mission: stop treating every already-
// computed v4/clip-ranking signal as an independent vote, and instead compose
// them into ONE editorial authority - EditorialDecision - the same way a
// human editor would read a candidate: what does it need to open with
// context, does it pay off, is it redundant with something else already
// picked, does it end abruptly.
//
// Two modes share this one contract (see @speedora/editorial-director's
// compute-editorial-decision.ts):
// - 'shortlist': runs pre-render, inside @speedora/candidate-shortlist,
//   using only ungrounded/transcript-only signals (ClipScores, transcript-
//   only SemanticEvent[]/NarrativeGraph - no OCR/object/face grounding
//   exists yet at this stage). Real behavior effects: negative-signal
//   penalties, a bounded boundary nudge, diversity-aware re-selection.
// - 'render': runs post-render, inside render-clip.worker.ts, using the full
//   GROUNDED v4 signals plus editingSuggestions density/clustering and
//   conversation/multi-speaker data. Scoring/observability only this phase -
//   does not gate or reject rendering (that's a later phase).
//
// Every numeric field below is a documented HEURISTIC (ADR D4, docs/
// coding-standards.md's "scale honesty") - no production engagement data
// exists yet to calibrate weights/penalties against (same 0-usable-samples
// blocker every other phase in this roadmap already documents). Never
// present these as ML-model output downstream (UI copy, API docs) without
// this caveat.

export const EDITORIAL_MODES = ['shortlist', 'render'] as const;
export const editorialModeSchema = z.enum(EDITORIAL_MODES);
export type EditorialMode = z.infer<typeof editorialModeSchema>;

// The structural fix for clip-ranking's own documented double-counting bug
// (12-13 raw sub-scores averaged despite sharing common ancestors, see
// docs/ai/clip-ranking-engine.md) - a SMALLER set of named editorial
// categories, each with its own documented, mostly-non-overlapping source-
// signal mapping (see @speedora/editorial-director's weights.ts). Not a
// weight-tuning claim; the fix is "stop re-counting the same ancestor signal
// under different names," not "these are the objectively correct weights."
export const EDITORIAL_CATEGORIES = [
  'contentValue',
  'hookStrength',
  'narrativeCompleteness',
  'contextCompleteness',
  'emotionalPayoff',
  'visualEngagement',
  'speakerClarity',
  'platformFit',
] as const;
export type EditorialCategory = (typeof EDITORIAL_CATEGORIES)[number];

// visualEngagement/speakerClarity are render-mode only (null in shortlist
// mode - no editingSuggestions/conversation data exists pre-render). Every
// other category is populated in both modes, using whichever grounded/
// ungrounded inputs that mode actually has.
export const editorialCategoryScoresSchema = z.object({
  contentValue: z.number().min(0).max(100),
  hookStrength: z.number().min(0).max(100),
  narrativeCompleteness: z.number().min(0).max(100),
  contextCompleteness: z.number().min(0).max(100),
  emotionalPayoff: z.number().min(0).max(100),
  visualEngagement: z.number().min(0).max(100).nullable(),
  speakerClarity: z.number().min(0).max(100).nullable(),
  platformFit: z.number().min(0).max(100),
});
export type EditorialCategoryScores = z.infer<typeof editorialCategoryScoresSchema>;

// Section 7 (Negative Intelligence) of the mission - "what makes this clip
// bad?", not just "what is good?". visualInstability/overEditingRisk are
// render-mode only (need editingSuggestions, which don't exist pre-render).
// redundancy is shortlist-mode only (a cross-candidate comparison - render
// mode never re-runs diversity selection across already-fixed siblings).
export const NEGATIVE_SIGNAL_TYPES = [
  'contextDependency',
  'redundancy',
  'deadAir',
  'confusion',
  'incompleteThought',
  'abruptEnding',
  'setupTooLong',
  'payoffMissing',
  'visualInstability',
  'overEditingRisk',
] as const;
export type NegativeSignalType = (typeof NEGATIVE_SIGNAL_TYPES)[number];

export const negativeSignalSchema = z.object({
  type: z.enum(NEGATIVE_SIGNAL_TYPES),
  // 0-100 - points DEDUCTED from the weighted category average, not a
  // probability. Each type has its own cap (see weights.ts PENALTY_CAPS);
  // 0 is a real, common result (this signal simply didn't fire), not an
  // absence.
  penalty: z.number().min(0).max(100),
  // Human-readable explanation, same "written for a human, not a log
  // message" convention as clip-scoring's own `reason` field.
  reason: z.string(),
});
export type NegativeSignal = z.infer<typeof negativeSignalSchema>;

// Section 5 (Narrative Boundary Intelligence) of the mission, scoped to
// PRE-RENDER/ungrounded only for this phase (a user-confirmed scope
// decision - post-render grounded re-cut/re-render is explicitly deferred,
// see docs/ai/editorial-director.md). `applied` is false whenever the
// nudge's own bounds check failed (exceeds the configured max expansion) or
// no narrativeGraph was available to nudge against - the caller
// (@speedora/candidate-shortlist) only ever acts on `applied: true`.
export const boundaryNudgeSchema = z.object({
  originalStartTime: z.number(),
  originalEndTime: z.number(),
  suggestedStartTime: z.number(),
  suggestedEndTime: z.number(),
  reason: z.string(),
  applied: z.boolean(),
});
export type BoundaryNudge = z.infer<typeof boundaryNudgeSchema>;

export const editorialDecisionSchema = z.object({
  mode: editorialModeSchema,
  // Weighted composite over `categories` (re-normalized over whichever
  // categories are non-null for this mode, same "average of non-null"
  // convention @speedora/clip-ranking's own compositeScore already uses),
  // minus the sum of `negativeSignals[].penalty` (capped, see weights.ts
  // MAX_TOTAL_PENALTY), clamped to [0, 100].
  editorialScore: z.number().min(0).max(100),
  categories: editorialCategoryScoresSchema,
  negativeSignals: z.array(negativeSignalSchema),
  // shortlist mode only - always null in render mode (Phase A does not
  // re-cut a clip post-render).
  boundaryNudge: boundaryNudgeSchema.nullable(),
  // CODE-COMPUTED coverage: count(non-null categories) / total categories
  // for this mode - same "kind of confidence" as ClipRank.confidence/
  // ViralityPrediction.confidence, not an LLM self-report.
  confidence: z.number().min(0).max(1),
});
export type EditorialDecision = z.infer<typeof editorialDecisionSchema>;
