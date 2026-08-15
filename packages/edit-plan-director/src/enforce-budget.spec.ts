import type { EditBudget, EditingSuggestion } from '@speedora/contracts';
import { enforceBudget } from './enforce-budget';

function suggestion(overrides: Partial<EditingSuggestion>): EditingSuggestion {
  return {
    technique: 'digital_push',
    start: 0,
    end: 1,
    score: 0.5,
    reason: 'test fixture',
    ...overrides,
  };
}

const ZERO_BUDGET: EditBudget = {
  maxFocusShifts: 0,
  maxSpeakerFocusShifts: 0,
  maxDigitalPush: 0,
  maxOcrHighlights: 0,
  maxReactionHolds: 0,
};

describe('enforceBudget', () => {
  it('drops the lowest-score suggestion of a technique first when over budget', () => {
    const high = suggestion({ technique: 'digital_push', start: 0, end: 1, score: 0.9 });
    const low = suggestion({ technique: 'digital_push', start: 10, end: 11, score: 0.2 });
    const budget: EditBudget = { ...ZERO_BUDGET, maxDigitalPush: 1 };

    const result = enforceBudget([high, low], budget);

    expect(result.suggestions).toEqual([high]);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: 'suppressed',
        reasonCode: 'over_budget',
        technique: 'digital_push',
        start: 10,
      }),
    ]);
  });

  it('keeps every suggestion of a technique when under budget', () => {
    const a = suggestion({ technique: 'digital_push', start: 0, end: 1, score: 0.9 });
    const b = suggestion({ technique: 'digital_push', start: 10, end: 11, score: 0.2 });
    const budget: EditBudget = { ...ZERO_BUDGET, maxDigitalPush: 5 };

    const result = enforceBudget([a, b], budget);

    expect(result.suggestions).toHaveLength(2);
    expect(result.decisions).toHaveLength(0);
  });

  it('passes pause_hold/attention_cut through untouched regardless of budget', () => {
    const pauseHold = suggestion({ technique: 'pause_hold', start: 0, end: 1, score: 0.1 });
    const attentionCut = suggestion({ technique: 'attention_cut', start: 5, end: 6, score: 0.1 });

    const result = enforceBudget([pauseHold, attentionCut], ZERO_BUDGET);

    expect(result.suggestions).toEqual(expect.arrayContaining([pauseHold, attentionCut]));
    expect(result.decisions).toHaveLength(0);
  });

  it('enforces each budgeted technique independently', () => {
    const focusShift = suggestion({ technique: 'focus_shift', start: 0, end: 1, score: 0.9 });
    const digitalPush = suggestion({ technique: 'digital_push', start: 5, end: 6, score: 0.9 });
    const budget: EditBudget = { ...ZERO_BUDGET, maxFocusShifts: 1, maxDigitalPush: 0 };

    const result = enforceBudget([focusShift, digitalPush], budget);

    expect(result.suggestions).toEqual([focusShift]);
    expect(result.decisions).toEqual([expect.objectContaining({ technique: 'digital_push' })]);
  });

  it('preserves original chronological ordering after dropping suggestions', () => {
    const first = suggestion({ technique: 'digital_push', start: 0, end: 1, score: 0.9 });
    const second = suggestion({ technique: 'focus_shift', start: 5, end: 6, score: 0.9 });
    const third = suggestion({ technique: 'digital_push', start: 10, end: 11, score: 0.9 });
    const budget: EditBudget = { ...ZERO_BUDGET, maxDigitalPush: 2, maxFocusShifts: 1 };

    const result = enforceBudget([third, first, second], budget);

    expect(result.suggestions.map((s) => s.start)).toEqual([0, 5, 10]);
  });

  it('never crashes on an empty suggestions array', () => {
    expect(enforceBudget([], ZERO_BUDGET)).toEqual({ suggestions: [], decisions: [] });
  });
});
