// AI Intelligence v4 Track B, Phase A1 - follows isRetentionCurveInsightsEnabled()'s
// exact shape (ADR D8): a boolean env var, read lazily (function body, not
// a module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `subtitleIntelligence`,
// not computation - the render-graph node always runs (it's optional:
// false, pure computation, not an LLM call that can fail) and persists
// Clip.subtitleIntelligence regardless, matching every other v4 pure-derive
// node's flag.
export function isSubtitleRewriteEnabled(): boolean {
  return process.env.SUBTITLE_REWRITE_ENABLED === 'true';
}
