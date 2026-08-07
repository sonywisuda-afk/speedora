// AI Intelligence v4, Phase 3 - follows isHookPredictionEnabled()'s/
// isSemanticEventDetectionEnabled()'s exact shape (ADR D8): a boolean env
// var, read lazily (function body, not a module-level const) so it isn't
// captured before dotenv's config() call runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `narrativeGraph`, not
// computation - the render-graph node always runs and persists
// Clip.narrativeGraph regardless, matching Phases 1-2's own flags.
export function isNarrativeGraphEnabled(): boolean {
  return process.env.NARRATIVE_GRAPH_ENABLED === 'true';
}
