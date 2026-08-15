import { computeEditBudget } from './compute-edit-budget';
import {
  BASELINE_CLIP_DURATION_SECONDS,
  BASELINE_MAX_DIGITAL_PUSH,
  BASELINE_MAX_FOCUS_SHIFTS,
  BASELINE_MAX_OCR_HIGHLIGHTS,
  BASELINE_MAX_REACTION_HOLDS,
  BASELINE_MAX_SPEAKER_FOCUS_SHIFTS,
} from './weights';

describe('computeEditBudget', () => {
  it('returns the baseline caps for a clip at the baseline duration with 2+ speakers and no instability', () => {
    const budget = computeEditBudget({
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });
    expect(budget).toEqual({
      maxFocusShifts: BASELINE_MAX_FOCUS_SHIFTS,
      maxSpeakerFocusShifts: BASELINE_MAX_SPEAKER_FOCUS_SHIFTS,
      maxDigitalPush: BASELINE_MAX_DIGITAL_PUSH,
      maxOcrHighlights: BASELINE_MAX_OCR_HIGHLIGHTS,
      maxReactionHolds: BASELINE_MAX_REACTION_HOLDS,
    });
  });

  it('scales caps up for a longer clip, clamped at 2x', () => {
    const budget = computeEditBudget({
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS * 10,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });
    expect(budget.maxFocusShifts).toBe(Math.round(BASELINE_MAX_FOCUS_SHIFTS * 2));
  });

  it('scales caps down for a shorter clip, clamped at 0.5x', () => {
    const budget = computeEditBudget({
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS / 10,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });
    expect(budget.maxFocusShifts).toBe(Math.round(BASELINE_MAX_FOCUS_SHIFTS * 0.5));
  });

  it('halves every cap when the clip already has a visualInstability/overEditingRisk penalty', () => {
    const withInstability = computeEditBudget({
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: true,
    });
    const without = computeEditBudget({
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });
    expect(withInstability.maxDigitalPush).toBeLessThan(without.maxDigitalPush);
    expect(withInstability.maxOcrHighlights).toBeLessThan(without.maxOcrHighlights);
  });

  it('zeroes maxSpeakerFocusShifts for a monologue clip without penalizing other caps', () => {
    const budget = computeEditBudget({
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 1,
      hasVisualInstabilityOrOverEditingRisk: false,
    });
    expect(budget.maxSpeakerFocusShifts).toBe(0);
    expect(budget.maxFocusShifts).toBe(BASELINE_MAX_FOCUS_SHIFTS);
  });

  it('zeroes maxSpeakerFocusShifts when there is no diarization data at all (speakerCount 0)', () => {
    const budget = computeEditBudget({
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 0,
      hasVisualInstabilityOrOverEditingRisk: false,
    });
    expect(budget.maxSpeakerFocusShifts).toBe(0);
  });

  it('never returns a negative cap', () => {
    const budget = computeEditBudget({
      clipDurationSeconds: 0,
      speakerCount: 0,
      hasVisualInstabilityOrOverEditingRisk: true,
    });
    for (const value of Object.values(budget)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
