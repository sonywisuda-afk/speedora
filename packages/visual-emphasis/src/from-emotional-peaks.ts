import type { EditingSuggestion, RetentionPoint } from '@speedora/contracts';

// A single-face-tracker limitation, stated honestly (same "don't claim
// more than the pipeline can support" discipline as Object Intelligence's
// interactionConfidence naming): this pipeline has no multi-face tracking
// yet (see docs/ai/object-intelligence.md's "Explicitly out of scope"),
// so "Reaction Hold" cannot distinguish a bystander's reaction from the
// active speaker's own emotional delivery - it reduces to "the currently
// tracked subject shows a strong emotional read," not true multi-person
// reaction detection. Reuses Phase 10's Retention Curve Insights
// emotionalPeaks (itself a local maximum in Phase 5's EmotionalArc
// intensity) directly - no new peak-detection logic of this module's own.
const REACTION_HOLD_WINDOW_SECONDS = 1.5;

export function fromEmotionalPeaks(emotionalPeaks: RetentionPoint[]): EditingSuggestion[] {
  return emotionalPeaks.map((peak) => ({
    technique: 'reaction_hold',
    start: Math.max(0, peak.t - REACTION_HOLD_WINDOW_SECONDS / 2),
    end: peak.t + REACTION_HOLD_WINDOW_SECONDS / 2,
    score: peak.score,
    reason:
      'Reuses a Retention Curve Insights emotionalPeaks moment (Phase 10) - a local maximum in vocal emotional intensity.',
  }));
}
