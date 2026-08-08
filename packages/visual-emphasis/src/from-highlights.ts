import type { EditingSuggestion, HighlightMoment } from '@speedora/contracts';

// 'digital_push' covers both "Auto Zoom" and "Digital Push" from spec Part
// 9 - the same push-in-zoom motion @speedora/reframe's buildCropPath()
// already renders (Fase 11), just keyword-regex triggered only today.
// This function contributes v4's own richer "this moment matters"
// judgment - Phase A1/B1's own HighlightTimeline, already a fusion of
// emotion/semantic-event/momentum signals (the SAME timeline Dynamic
// Caption Engine's punch animation already reuses, see
// @speedora/dynamic-caption) - a straight 1:1 relabeling, no re-derivation
// of any kind. Wiring this into buildCropPath()'s actual trigger set is
// Phase C4's job, not this one (DB4/DC4's "data first" split).
export function fromHighlights(highlights: HighlightMoment[]): EditingSuggestion[] {
  return highlights.map((highlight) => ({
    technique: 'digital_push',
    start: highlight.start,
    end: highlight.end,
    score: highlight.score,
    reason:
      'Reuses the HighlightTimeline (Phase A1/B1) - an emotion/semantic-event/momentum-fused punch-worthy moment.',
  }));
}
