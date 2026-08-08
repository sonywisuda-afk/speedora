import { computeSilenceCuts } from '@speedora/cutlist';
import type { EditingSuggestion, RetentionPoint, TranscriptWordInput } from '@speedora/contracts';

// How close a Retention Curve Insights point must land to a pause gap to
// "explain" it as a deliberate dramatic beat rather than dead air -
// a documented HEURISTIC (ADR D4), no readability data behind the exact
// number. @speedora/cutlist's own computeSilenceCuts() already decides
// which gaps are long enough to be "worth cutting" in the first place
// (its own MIN_SILENCE_GAP_SECONDS, 0.7s) - this module never re-derives
// that threshold, only asks "should THIS one particular gap be spared."
const PAUSE_PROXIMITY_SECONDS = 1.5;

type TaggedPoint = RetentionPoint & { kind: 'curiosity' | 'drop-off' };

// "Pause Hold" (spec Part 9) - @speedora/cutlist's Smart Trim removes
// every sufficiently-long silence unconditionally today (Tech Debt #4,
// docs/ai/visual-emphasis-engine.md); this function finds which of those
// SAME gaps land near a Phase 10 Retention Curve Insights point
// (curiosityPeaks - an information-gap-evoking semantic event nearby;
// dropPoints - a momentum trough, often the beat right before a recovery)
// and are therefore worth PROTECTING from that trim, rather than treating
// as dead air. Reuses computeSilenceCuts()'s own gap detection directly -
// no new silence-detection logic of this module's own, same reuse
// @speedora/hook-prediction's derivePauseFeatures already established for
// this exact function.
export function fromPauses(
  words: TranscriptWordInput[],
  clipDurationSeconds: number,
  curiosityPeaks: RetentionPoint[],
  dropPoints: RetentionPoint[],
): EditingSuggestion[] {
  const gaps = computeSilenceCuts(words, clipDurationSeconds);
  if (gaps.length === 0) return [];

  const candidates: TaggedPoint[] = [
    ...curiosityPeaks.map((point) => ({ ...point, kind: 'curiosity' as const })),
    ...dropPoints.map((point) => ({ ...point, kind: 'drop-off' as const })),
  ];

  const suggestions: EditingSuggestion[] = [];
  for (const gap of gaps) {
    let best: TaggedPoint | null = null;
    for (const point of candidates) {
      const nearGap =
        point.t >= gap.start - PAUSE_PROXIMITY_SECONDS &&
        point.t <= gap.end + PAUSE_PROXIMITY_SECONDS;
      if (nearGap && (!best || point.score > best.score)) {
        best = point;
      }
    }
    if (best) {
      suggestions.push({
        technique: 'pause_hold',
        start: gap.start,
        end: gap.end,
        score: best.score,
        reason: `Pause lands near a ${best.kind} moment (Retention Curve Insights, Phase 10)`,
      });
    }
  }

  return suggestions;
}
