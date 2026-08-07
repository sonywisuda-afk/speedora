import { z } from 'zod';

// AI Intelligence v4, Phase 2 (see docs/ai/intelligence-v4.md) - Semantic
// Event Detection's own prerequisite: spec Part 6 (Multimodal Reasoning)
// pulled forward as a small, standalone correlation utility rather than a
// Semantic-Event-Detection-only private detail, since the roadmap already
// names two more future consumers (Emotional Arc/Retention Curve, Virality
// Engine's reasoning) - same "extract standalone ahead of a second real
// consumer" precedent as packages/primary-subject.
//
// A GroundedFact is deliberately NOT causal to event detection - the LLM
// reasons over transcript text alone (packages/semantic-events'
// extract-raw-events.ts); grounding is a separate, deterministic
// post-processing step (@speedora/multimodal-reasoning's
// findConcurrentEvidence) that cites whichever already-computed OcrTextTrack/
// ObjectTrack entries were on screen around a detected event's timestamp -
// keeps the LLM prompt simple and the grounding logic independently
// testable.
export const GROUNDED_FACT_SOURCES = ['ocr', 'object'] as const;
export type GroundedFactSource = (typeof GROUNDED_FACT_SOURCES)[number];

export const groundedFactSchema = z.object({
  source: z.enum(GROUNDED_FACT_SOURCES),
  // The OCR track's own text, or the object track's category label -
  // whichever concurrent signal this fact cites.
  text: z.string(),
  // Clip-relative seconds - the track's own representative timestamp
  // (midpoint of its [startTime, endTime] span), not the event's t.
  t: z.number(),
});
export type GroundedFact = z.infer<typeof groundedFactSchema>;
