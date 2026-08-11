// Speaker Intelligence Phase F - follows isConversationIntelligenceEnabled()'s
// exact shape: a boolean env var, read lazily (function body, not a
// module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `finalSpeakerIntelligence`,
// not computation - the render-graph node always runs (it's optional: false,
// pure computation over already-computed signals, not an LLM call that can
// fail) and persists Clip.finalSpeakerIntelligence regardless.
export function isSpeakerFusionEnabled(): boolean {
  return process.env.SPEAKER_FUSION_ENABLED === 'true';
}
