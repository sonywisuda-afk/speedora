// AI Intelligence v4, Phase 11 - follows isRetentionCurveInsightsEnabled()'s exact shape (ADR D8):
// a boolean env var, read lazily (function body, not a module-level const) so it isn't captured
// before dotenv's config() call runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `multimodalReasoning`, not computation - the
// render-graph node always attempts to run (it's optional: true/fallback: null, same as every
// other LLM-backed v4 node - the LLM call can fail, that never fails the render job) and persists
// Clip.multimodalReasoning regardless, matching every prior phase's own flag.
export function isMultimodalReasoningEnabled(): boolean {
  return process.env.MULTIMODAL_REASONING_ENABLED === 'true';
}
