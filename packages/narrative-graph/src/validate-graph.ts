import type { NarrativeGraph } from '@speedora/contracts';

// A single segment isn't a meaningful "graph" - matches this phase's own
// framing (segmenting INTO a structure, not just labeling the whole clip
// with one tag).
const MIN_SEGMENTS = 2;

// Small floating-point/LLM-rounding tolerance on the clip-bounds check -
// not a real content allowance, just avoids a false "unsegmented" from a
// segment ending at e.g. 30.02s on a 30.0s clip.
const BOUNDS_TOLERANCE_SECONDS = 0.5;

const UNSEGMENTED: NarrativeGraph = { segments: [], relations: [], unsegmented: true };

// Pure post-LLM structural validation (ADR D2 - no LLM/DB access). Collapses
// to the "unsegmented" fallback (a real, successful result - see
// narrativeGraphSchema's own doc comment) on ANY structural problem, rather
// than attempting a partial repair - a half-fixed graph is exactly the kind
// of silently-wrong output this phase's risk mitigation exists to avoid.
// Checks, in order: at least MIN_SEGMENTS segments; every segment's
// startTime < endTime and within [0, clipDurationSeconds] (with tolerance);
// every relation references a real segment id.
export function validateGraph(raw: NarrativeGraph, clipDurationSeconds: number): NarrativeGraph {
  if (raw.unsegmented) {
    return UNSEGMENTED;
  }

  if (raw.segments.length < MIN_SEGMENTS) {
    return UNSEGMENTED;
  }

  for (const segment of raw.segments) {
    if (segment.startTime >= segment.endTime) {
      return UNSEGMENTED;
    }
    if (
      segment.startTime < -BOUNDS_TOLERANCE_SECONDS ||
      segment.endTime > clipDurationSeconds + BOUNDS_TOLERANCE_SECONDS
    ) {
      return UNSEGMENTED;
    }
  }

  const segmentIds = new Set(raw.segments.map((segment) => segment.id));
  for (const relation of raw.relations) {
    if (!segmentIds.has(relation.fromSegmentId) || !segmentIds.has(relation.toSegmentId)) {
      return UNSEGMENTED;
    }
  }

  return raw;
}
