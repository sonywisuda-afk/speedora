// AI Intelligence v4 Phase 13.1 (Clip Ranking Engine, see
// docs/ai/clip-ranking-engine.md) - follows isHookPredictionEnabled()'s exact
// shape (packages/hook-prediction/src/feature-flags.ts), this codebase's
// established feature-flag precedent (ADR D8): a boolean env var, read
// lazily (function body, not a module-level const) so it isn't captured
// before dotenv's config() call runs elsewhere in the process.
//
// Unlike most v4 flags (which gate DTO EXPOSURE while computation always
// runs "collected but inert"), this one gates real computation: how many
// candidates apps/worker's detect-clips.worker.ts asks scoreClipCandidates()
// for by default. Raising that count is a real paid-LLM-call behavior
// change, not a free/idempotent analysis step, so it can't default to
// "always on" the way weight-0 signals do - see clip-ranking-engine.md's
// ADR D17 (single expanded LLM call, accepted dilution risk pending
// measurement). An explicit Video.processingOptions.clipGeneration.clipCount
// always wins over this flag either way (see detect-clips.worker.ts's
// toScoringInput()) - this only changes the OMITTED-clipCount default.
export function isCandidateExpansionEnabled(): boolean {
  return process.env.CANDIDATE_EXPANSION_ENABLED === 'true';
}

// The Stage A pool size target from the Clip Ranking Engine's 3-stage funnel
// (docs/ai/clip-ranking-engine.md ADR D16) - large enough that Stage B (Phase
// 13.2, not yet built) has real material to shortlist from, without asking
// the single-call generation strategy (D17) for more than one LLM call can
// reasonably reason about at once. Only takes effect when
// isCandidateExpansionEnabled() is true AND the caller didn't already
// request an explicit clipCount.
export const CANDIDATE_EXPANSION_POOL_SIZE = 30;
