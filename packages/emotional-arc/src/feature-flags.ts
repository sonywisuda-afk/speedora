// AI Intelligence v4, Phase 5 - follows isContextualMomentumEnabled()'s
// exact shape (ADR D8): a boolean env var, read lazily (function body, not
// a module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `emotionalArc`, not
// computation - the render-graph node always runs (it's optional: false,
// pure computation, not an LLM call that can fail) and persists
// Clip.emotionalArc regardless, matching Phase 4's own flag.
export function isEmotionalArcEnabled(): boolean {
  return process.env.EMOTIONAL_ARC_ENABLED === 'true';
}
