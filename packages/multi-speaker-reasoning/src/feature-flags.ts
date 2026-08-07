// AI Intelligence v4, Phase 6 - follows isEmotionalArcEnabled()'s exact
// shape (ADR D8): a boolean env var, read lazily (function body, not a
// module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `multiSpeakerBreakdown`,
// not computation - the render-graph node always runs (it's optional:
// false, pure computation, not an LLM call that can fail) and persists
// Clip.multiSpeakerBreakdown regardless, matching Phase 4/5's own flags.
export function isMultiSpeakerReasoningEnabled(): boolean {
  return process.env.MULTI_SPEAKER_REASONING_ENABLED === 'true';
}
