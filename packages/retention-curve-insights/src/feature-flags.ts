// AI Intelligence v4, Phase 10 - follows isViralityEngineEnabled()'s exact
// shape (ADR D8): a boolean env var, read lazily (function body, not a
// module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `retentionCurveInsights`,
// not computation - the render-graph node always runs (it's optional:
// false, pure computation, not an LLM call that can fail) and persists
// Clip.retentionCurveInsights regardless, matching Phase 4/5/6/9's own
// flags.
export function isRetentionCurveInsightsEnabled(): boolean {
  return process.env.RETENTION_CURVE_INSIGHTS_ENABLED === 'true';
}
