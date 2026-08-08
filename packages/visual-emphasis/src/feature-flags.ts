// AI Intelligence v4 Track B, Phase C1 - follows isDynamicCaptionEnabled()'s
// exact shape (ADR D8): a boolean env var, read lazily (function body, not
// a module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `editingSuggestions`,
// not computation - the render-graph node always runs (it's optional:
// false, pure computation, not an LLM call that can fail) and persists
// Clip.editingSuggestions regardless, matching every other v4 pure-derive
// node's flag. Does NOT gate any render-pipeline behavior - Phase C1 has
// none; that's C2-C7's job, each with its own flag/toggle when designed.
export function isVisualEmphasisEnabled(): boolean {
  return process.env.VISUAL_EMPHASIS_ENABLED === 'true';
}
