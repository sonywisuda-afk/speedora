// AI Intelligence v4, Phase 2 - follows isHookPredictionEnabled()'s exact
// shape (ADR D8): a boolean env var, read lazily (function body, not a
// module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `semanticEvents`, not
// computation - the render-graph node always runs and persists
// Clip.semanticEvents regardless, matching Phase 1's hookPrediction flag.
export function isSemanticEventDetectionEnabled(): boolean {
  return process.env.SEMANTIC_EVENT_DETECTION_ENABLED === 'true';
}
