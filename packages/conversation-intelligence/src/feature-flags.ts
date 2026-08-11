// Speaker Intelligence Phase C - follows isContextualMomentumEnabled()'s
// exact shape: a boolean env var, read lazily (function body, not a
// module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `conversationDynamics`/
// `conversationType`, not computation - the render-graph node always runs
// (it's optional: false, pure computation over already-computed
// DiarizationFeatures, not an LLM call that can fail) and persists
// Clip.conversationDynamics/conversationType regardless.
export function isConversationIntelligenceEnabled(): boolean {
  return process.env.CONVERSATION_INTELLIGENCE_ENABLED === 'true';
}
