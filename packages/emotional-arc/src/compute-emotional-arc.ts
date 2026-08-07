import type {
  ComputeEmotionalArcInput,
  EmotionalArc,
  SemanticEvent,
  VocalEmotion,
} from '@speedora/contracts';
import { VOCAL_EMOTIONS } from '@speedora/contracts';
import { emotionalBoostForSemanticEventType } from './emotional-event-boost';

// Every constant below is a documented HEURISTIC (ADR D4) - not derived
// from any real engagement data, and carrying forward the underlying
// classifier's own documented caveat (superb/wav2vec2-base-superb-er,
// trained on IEMOCAP's *acted*, not natural, speech - see
// @speedora/contracts' vocal-emotion.ts). A fixed ordering over the
// model's own 4-class taxonomy: 'neu' gets a mild non-zero baseline
// (speech is never fully "flat"), 'sad'/'hap'/'ang' rise from there.
const BASE_INTENSITY: Record<VocalEmotion, number> = {
  neu: 0.1,
  sad: 0.55,
  hap: 0.65,
  ang: 0.85,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isVocalEmotion(value: string): value is VocalEmotion {
  return (VOCAL_EMOTIONS as readonly string[]).includes(value);
}

// Largest boost among every semantic event whose `t` falls inside
// [start, end] - MAX, not summed, so an event-dense segment doesn't run
// away to 1.0 (same "one governing value per sample" shape Phase 4's
// segmentAt() uses for narrative segments). Degrades to 0 when
// semanticEvents is null/empty/has no event in range - same "optional
// context, never a hard dependency" pattern Phase 3/4 already use for it.
function boostForSegment(
  start: number,
  end: number,
  semanticEvents: SemanticEvent[] | null,
): number {
  if (!semanticEvents || semanticEvents.length === 0) {
    return 0;
  }
  let boost = 0;
  for (const event of semanticEvents) {
    if (event.t >= start && event.t <= end) {
      boost = Math.max(boost, emotionalBoostForSemanticEventType(event.type));
    }
  }
  return boost;
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter at all, same
// zero-LLM shape as @speedora/contextual-momentum. One sample per input
// segment (the transcript's own natural granularity, not resampled onto a
// fixed grid):
//   1. base intensity - a fixed per-emotion weight, or 0 when the segment
//      has no (or an unrecognized) emotion label.
//   2. semantic event boost - the largest tier boost among any Phase 2
//      SemanticEvent landing inside this segment's own window, when
//      available.
export function computeEmotionalArc(input: ComputeEmotionalArcInput): EmotionalArc {
  return input.segments.map((segment) => {
    const emotion =
      segment.emotion !== null && isVocalEmotion(segment.emotion) ? segment.emotion : null;
    const base = emotion !== null ? BASE_INTENSITY[emotion] : 0;
    const boost = boostForSegment(segment.start, segment.end, input.semanticEvents);

    return {
      t: segment.start,
      emotion,
      intensity: clamp01(base + boost),
    };
  });
}
