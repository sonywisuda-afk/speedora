import { z } from 'zod';
import { groundedFactSchema } from './multimodal-reasoning';

// AI Intelligence v4, Phase 2 (Semantic Event Detection - see docs/ai/
// intelligence-v4.md). LLM-reasoning timeline of narrative events - the raw
// material Phase 3 (Narrative Graph) segments against later. The 22-value
// taxonomy below is the exact list from the original brief, in
// lowercase/snake_case (multi-word categories get an underscore, same
// convention as every other small `as const` taxonomy in this codebase -
// CLIP_INTENTS, HOOK_SENTIMENTS).
//
// This is a plain string union in a JSON blob (Clip.semanticEvents), not a
// Prisma-column enum - same shape as ClipIntent/HookSentiment, so there is
// no Prisma<->shared boundary cast to govern (Contract Governance rules 2-4
// don't apply). Rule 1's exhaustiveness discipline still does:
// packages/semantic-events' describeEventType() is a real exhaustive
// switch/assertNever over every value below, so adding a 23rd type later is
// a compile error until that switch is updated - satisfied from day 1
// rather than retrofitted.
export const SEMANTIC_EVENT_TYPES = [
  'confession',
  'mistake',
  'failure',
  'success',
  'secret',
  'warning',
  'prediction',
  'tutorial',
  'breaking_news',
  'conflict',
  'lawsuit',
  'money',
  'ai',
  'business',
  'career',
  'health',
  'fear',
  'urgency',
  'controversy',
  'achievement',
  'transformation',
  'life_lesson',
] as const;
export type SemanticEventType = (typeof SEMANTIC_EVENT_TYPES)[number];

// Deliberately narrower than hook-prediction's hookPredictionSegmentSchema
// (no emotion/words) - semantic event detection's one LLM call only needs
// plain transcript text + timing, same "keep input narrow" convention as
// every other module input (ARCHITECTURE.md's checklist).
export const semanticEventDetectionSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});
export type SemanticEventDetectionSegment = z.infer<typeof semanticEventDetectionSegmentSchema>;

// Every numeric field below is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no production engagement
// data exists yet to calibrate confidence/importance against.
export const semanticEventSchema = z.object({
  type: z.enum(SEMANTIC_EVENT_TYPES),
  // Clip-relative seconds - the LLM's own approximate placement of this
  // event within the transcript, not snapped to a word/segment boundary.
  t: z.number(),
  // How confident the detection itself is that this moment really matches
  // `type` (0-1) - distinct from `importance` below.
  confidence: z.number().min(0).max(1),
  // How significant this moment is to the clip's overall narrative (0-1) -
  // a quiet, certain "mistake" can still be low-importance; a loud,
  // ambiguous one can still be high-importance. Kept as a separate
  // dimension from confidence rather than one blended score, same
  // "don't collapse two different questions into one number" reasoning as
  // Object Intelligence's attentionScore/attentionConfidence split.
  importance: z.number().min(0).max(1),
  // On-screen facts (OCR text / detected objects) concurrent with `t` -
  // may be empty (nothing was on screen, or OCR/object detection itself
  // never ran/found nothing for this clip). See
  // @speedora/multimodal-reasoning's findConcurrentEvidence.
  evidence: z.array(groundedFactSchema),
  // Human-readable explanation, same "written for a human, not a log
  // message" convention as clip-scoring's own `reason` field.
  reason: z.string(),
});
export type SemanticEvent = z.infer<typeof semanticEventSchema>;
