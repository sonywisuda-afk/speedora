import type { EditBudget } from '@speedora/contracts';
import {
  BASELINE_CLIP_DURATION_SECONDS,
  BASELINE_MAX_DIGITAL_PUSH,
  BASELINE_MAX_FOCUS_SHIFTS,
  BASELINE_MAX_OCR_HIGHLIGHTS,
  BASELINE_MAX_REACTION_HOLDS,
  BASELINE_MAX_SPEAKER_FOCUS_SHIFTS,
  INSTABILITY_BUDGET_MULTIPLIER,
  MAX_DURATION_SCALE,
  MIN_DURATION_SCALE,
} from './weights';

export interface ComputeEditBudgetInput {
  clipDurationSeconds: number;
  speakerCount: number;
  // Derived by the caller from Phase A's own EditorialDecision.negativeSignals - true when this
  // clip already carries a real, non-zero visualInstability or overEditingRisk penalty (see this
  // package's own contract doc comment for why this is a plain boolean, not a cross-package
  // dependency on @speedora/editorial-director).
  hasVisualInstabilityOrOverEditingRisk: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Never negative, never fractional - a budget cap is a count.
function roundCap(value: number): number {
  return Math.max(0, Math.round(value));
}

// Mission Section 12 ("Budget harus adaptif berdasarkan: clip duration; ... scene complexity;
// number of speakers; ... visual stability; narrative intensity"). Scene complexity/narrative
// intensity are deliberately NOT separate inputs here - Phase A's EditorialDecision already
// composes narrative completeness into its own categories, and visualInstability/overEditingRisk
// (this function's own `hasVisualInstabilityOrOverEditingRisk` input) already captures the "is this
// clip already visually busy" signal directly, rather than re-deriving a second, independent scene-
// complexity heuristic that would likely just correlate with the same underlying signals - the
// exact double-counting mistake docs/ai/clip-ranking-engine.md's own audit found and Phase A's
// Editorial Director was built to avoid repeating.
export function computeEditBudget(input: ComputeEditBudgetInput): EditBudget {
  const durationScale = clamp(
    input.clipDurationSeconds / BASELINE_CLIP_DURATION_SECONDS,
    MIN_DURATION_SCALE,
    MAX_DURATION_SCALE,
  );
  const instabilityMultiplier = input.hasVisualInstabilityOrOverEditingRisk
    ? INSTABILITY_BUDGET_MULTIPLIER
    : 1;
  const scale = durationScale * instabilityMultiplier;

  // speaker_focus_shift needs at least 2 distinct speakers to mean anything - zeroed for a
  // monologue clip rather than scored low, same non-penalization convention Phase A's own
  // deriveSpeakerClarityScore/clip-ranking's conversationEngagementScore already established for
  // solo content.
  const speakerFocusShiftScale = input.speakerCount <= 1 ? 0 : scale;

  return {
    maxFocusShifts: roundCap(BASELINE_MAX_FOCUS_SHIFTS * scale),
    maxSpeakerFocusShifts: roundCap(BASELINE_MAX_SPEAKER_FOCUS_SHIFTS * speakerFocusShiftScale),
    maxDigitalPush: roundCap(BASELINE_MAX_DIGITAL_PUSH * scale),
    maxOcrHighlights: roundCap(BASELINE_MAX_OCR_HIGHLIGHTS * scale),
    maxReactionHolds: roundCap(BASELINE_MAX_REACTION_HOLDS * scale),
  };
}
