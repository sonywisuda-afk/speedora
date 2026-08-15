import type { ConversationDynamics, ConversationTypeResult } from '@speedora/contracts';

// render-mode-only input for the `speakerClarity` category (see
// compose-editorial-score.ts). Null for the majority single-speaker/
// no-diarization-data case - same non-penalization convention
// @speedora/clip-ranking's own conversationEngagementScore already
// established (conversational clarity simply isn't a meaningful axis for
// monologue content, so it's excluded rather than dragging the composite
// down). Otherwise a simple heuristic over already-computed
// ConversationDynamics: less simultaneous-speech overlap reads as clearer.
export function deriveSpeakerClarityScore(
  dynamics: ConversationDynamics | null,
  classification: ConversationTypeResult | null,
): number | null {
  if (dynamics == null || classification == null) return null;
  if (classification.type === null || classification.type === 'monologue') return null;
  return Math.max(0, Math.min(100, 100 * (1 - dynamics.overlapRatio)));
}
