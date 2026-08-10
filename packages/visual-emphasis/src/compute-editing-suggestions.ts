import type {
  ComputeEditingSuggestionsInput,
  EditingSuggestionTimeline,
} from '@speedora/contracts';
import { fromDropPoints } from './from-drop-points';
import { fromEmotionalPeaks } from './from-emotional-peaks';
import { fromHighlights } from './from-highlights';
import { fromOcrTracks } from './from-ocr-tracks';
import { fromPauses } from './from-pauses';
import { fromPrimarySubjectSamples } from './from-primary-subject-samples';

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter, same zero-LLM
// shape as most of Track A/B. Combines all 5 spec Part 9 technique-specific
// derive functions PLUS fromDropPoints() (Attention Curve Optimization - a
// Phase 10 follow-up, NOT one of the 9 spec Part 9 techniques, reusing
// this same delivery shape - see from-drop-points.ts's own comment) and
// sorts the result into one chronological timeline - each technique's own
// detection logic lives in its own file (chunk-segment.ts-style "one
// function per concern" precedent), this file only composes them.
// "Generate editing suggestions" (spec Part 9) - this phase decides WHICH
// technique, WHEN, and WHY; wiring any suggestion into actual rendering is
// a later phase's job (C2-C7, see docs/ai/visual-emphasis-engine.md).
export function computeEditingSuggestions(
  input: ComputeEditingSuggestionsInput,
): EditingSuggestionTimeline {
  const {
    highlights,
    ocrTracks,
    primarySubjectSamples,
    retentionCurveInsights,
    words,
    clipDurationSeconds,
  } = input;

  return [
    ...fromHighlights(highlights),
    ...fromOcrTracks(ocrTracks),
    ...fromPrimarySubjectSamples(primarySubjectSamples),
    ...fromEmotionalPeaks(retentionCurveInsights.emotionalPeaks),
    ...fromPauses(
      words,
      clipDurationSeconds,
      retentionCurveInsights.curiosityPeaks,
      retentionCurveInsights.dropPoints,
    ),
    ...fromDropPoints(retentionCurveInsights.dropPoints, clipDurationSeconds),
  ].sort((a, b) => a.start - b.start);
}
