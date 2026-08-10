import type { EditingSuggestion, RetentionPoint } from '@speedora/contracts';

// Attention Curve Optimization - a Phase 10 (Retention Curve Insights)
// follow-up, NOT one of spec Part 9's 9 named Visual Emphasis techniques
// (that roadmap is its own complete, closed set - see docs/ai/
// visual-emphasis-engine.md). Reuses the same EditingSuggestionTimeline
// delivery shape rather than inventing a parallel one - see
// @speedora/contracts' own comment on EDITING_TECHNIQUES.
//
// Suggestion-only, by explicit user direction: flags a moment where
// predicted momentum drops sharply enough that a viewer plausibly starts
// losing interest ("detik 7, orang mulai bosan"), for a future phase to
// decide whether/how to act on (e.g. wiring it into computeClipCuts()
// alongside silence/filler cuts - see render-clip.worker.ts's own
// comment on that function). This phase does NOT cut anything - same
// "data first, action is a later phase's job" split every other Track B
// technique (C1 before C2-C7) already used.
//
// dropPoints is a HEURISTIC signal (ADR D4, docs/coding-standards.md's
// "scale honesty") - a momentum-curve local minimum, no real engagement
// data behind it. Only sufficiently severe drops are surfaced - a small
// wobble in an otherwise-lively clip isn't "the viewer is bored," it's
// normal pacing variance. `score` is already `1 - momentumScore` at the
// trough (see @speedora/retention-curve-insights' findDropPoints) - this
// threshold is deliberately conservative given the signal is unvalidated.
const ATTENTION_CUT_SEVERITY_THRESHOLD = 0.6;
// A fixed window around the drop point, not word-boundary-snapped (unlike
// @speedora/cutlist's computeFillerCuts/computeSilenceCuts) - this phase
// only generates a SUGGESTION, never an actual cut, so getting the exact
// edges right is deliberately left to whatever future phase wires this
// into rendering.
const ATTENTION_CUT_WINDOW_SECONDS = 2.5;

export function fromDropPoints(
  dropPoints: RetentionPoint[],
  clipDurationSeconds: number,
): EditingSuggestion[] {
  return dropPoints
    .filter((point) => point.score >= ATTENTION_CUT_SEVERITY_THRESHOLD)
    .map((point) => ({
      technique: 'attention_cut',
      start: Math.max(0, point.t - ATTENTION_CUT_WINDOW_SECONDS / 2),
      end: Math.min(clipDurationSeconds, point.t + ATTENTION_CUT_WINDOW_SECONDS / 2),
      score: point.score,
      reason:
        'Retention Curve Insights (Phase 10) predicts a sharp momentum drop here - a plausible point where a viewer starts losing interest. Suggestion only, not an applied cut.',
    }));
}
