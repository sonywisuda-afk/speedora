// AI Intelligence v4, Phase 4 - follows isNarrativeGraphEnabled()'s exact
// shape (ADR D8): a boolean env var, read lazily (function body, not a
// module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `contextualMomentum`, not
// computation - the render-graph node always runs (it's optional: false,
// pure computation, not an LLM call that can fail) and persists
// Clip.contextualMomentum regardless, matching Phases 1-3's own flags. Kept
// for consistency with the rest of v4 even though this phase has no LLM
// cost motivating a flag the way Phases 1-3 did.
export function isContextualMomentumEnabled(): boolean {
  return process.env.CONTEXTUAL_MOMENTUM_ENABLED === 'true';
}
