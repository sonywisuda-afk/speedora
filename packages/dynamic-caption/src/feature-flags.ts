// AI Intelligence v4 Track B, Phase B1 - follows isSubtitleRewriteEnabled()'s
// exact shape (ADR D8): a boolean env var, read lazily (function body, not
// a module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `captionTreatment`, not
// computation - the render-graph node always runs (it's optional: false,
// pure computation, not an LLM call that can fail) and persists
// Clip.captionTreatment regardless, matching every other v4 pure-derive
// node's flag. Does NOT gate any render-pipeline behavior yet - that is
// Phase B2's job (mirroring how SUBTITLE_REWRITE_ENABLED grew a
// render-path meaning only once Phase A2 shipped).
export function isDynamicCaptionEnabled(): boolean {
  return process.env.DYNAMIC_CAPTION_ENABLED === 'true';
}
