import type {
  EmotionalArcSample,
  HighlightMoment,
  MomentumSample,
  SemanticEvent,
  SubtitleLine,
} from '@speedora/contracts';
import { isPunchSemanticEventType } from './is-punch-semantic-event-type';
import { nearestByTime } from './nearest-by-time';

// "Punch"/"attention" moments (spec Part 8's future Dynamic Caption Engine
// consumes this directly, without recomputing emotion/momentum/semantic-
// event signals itself - see docs/ai/subtitle-intelligence.md's dependency
// graph). A HEURISTIC composite (ADR D4): averages whichever of (nearest
// EmotionalArc intensity, max isPunchSemanticEventType() importance inside
// the line's own [start, end] window, nearest MomentumCurve score) are
// available - same "average only non-null components" convention Phase
// 1/7's own composites already use. Only lines clearing PUNCH_THRESHOLD are
// returned - an honest "no punch-worthy moment found" empty array is a
// real result, same convention every other v4 array output uses.
const PUNCH_THRESHOLD = 0.6;

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxPunchImportance(
  line: SubtitleLine,
  semanticEvents: SemanticEvent[] | null,
): number | null {
  if (!semanticEvents || semanticEvents.length === 0) return null;
  let best: number | null = null;
  for (const event of semanticEvents) {
    if (event.t < line.start || event.t > line.end) continue;
    if (!isPunchSemanticEventType(event.type)) continue;
    best = best === null ? event.importance : Math.max(best, event.importance);
  }
  return best;
}

export function computeHighlightTimeline(
  lines: SubtitleLine[],
  emotionalArc: EmotionalArcSample[],
  momentumCurve: MomentumSample[],
  semanticEvents: SemanticEvent[] | null,
): HighlightMoment[] {
  const highlights: HighlightMoment[] = [];
  for (const line of lines) {
    const components: number[] = [];
    const nearestEmotion = nearestByTime(emotionalArc, line.start);
    if (nearestEmotion) components.push(nearestEmotion.intensity);
    const punchImportance = maxPunchImportance(line, semanticEvents);
    if (punchImportance !== null) components.push(punchImportance);
    const nearestMomentum = nearestByTime(momentumCurve, line.start);
    if (nearestMomentum) components.push(nearestMomentum.momentumScore);

    if (components.length === 0) continue;
    const score = average(components);
    if (score >= PUNCH_THRESHOLD) {
      highlights.push({ start: line.start, end: line.end, score });
    }
  }
  return highlights;
}
