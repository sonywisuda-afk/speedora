import type { EditingSuggestion, PrimarySubjectSample } from '@speedora/contracts';

// A trackId held for less than this reads as tracker flicker/noise, not a
// deliberate hold-then-shift worth suggesting - a documented HEURISTIC
// (ADR D4), no real data behind the exact number.
const MIN_HOLD_SECONDS = 1.0;
// A hold at or above this duration reads as maximally deliberate (score
// caps at 1.0) - shorter holds still qualify (above MIN_HOLD_SECONDS) but
// score proportionally lower.
const SCORE_NORMALIZATION_SECONDS = 3.0;
// A shift is a genuine instant (the sample where the new subject first
// appears), but every other technique in this module produces a real
// [start, end] range - a small symmetric window around that instant keeps
// EditingSuggestion's shape consistent for downstream consumers rather
// than a degenerate start === end range.
const FOCUS_SHIFT_WINDOW_SECONDS = 0.3;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// "Focus Shift" (spec Part 9) - @speedora/primary-subject's
// selectPrimarySubject() already decides, per sampled instant, which
// entity is "the subject" (active speaker -> face -> person -> attention
// object -> object); this function only looks for genuine trackId
// CHANGES in that already-computed sequence, never re-selecting anything
// itself. A shift FROM one real subject TO a different real subject only
// - disappearing to/from `null` (no subject detected at all) is a
// visibility/subjectLossRatio question Composition Intelligence already
// owns, not a Focus Shift.
export function fromPrimarySubjectSamples(samples: PrimarySubjectSample[]): EditingSuggestion[] {
  const suggestions: EditingSuggestion[] = [];
  let currentTrackId: number | null = null;
  let currentStart: number | null = null;

  for (const sample of samples) {
    if (sample.trackId !== currentTrackId) {
      if (currentTrackId !== null && sample.trackId !== null && currentStart !== null) {
        const held = sample.t - currentStart;
        if (held >= MIN_HOLD_SECONDS) {
          suggestions.push({
            technique: 'focus_shift',
            start: Math.max(0, sample.t - FOCUS_SHIFT_WINDOW_SECONDS / 2),
            end: sample.t + FOCUS_SHIFT_WINDOW_SECONDS / 2,
            score: clamp01(held / SCORE_NORMALIZATION_SECONDS),
            reason: `Primary subject changed after holding focus for ${held.toFixed(1)}s`,
          });
        }
      }
      currentTrackId = sample.trackId;
      currentStart = sample.t;
    }
  }

  return suggestions;
}
