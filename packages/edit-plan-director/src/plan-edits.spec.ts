import type { EditingSuggestion } from '@speedora/contracts';
import { planEdits } from './plan-edits';
import { BASELINE_CLIP_DURATION_SECONDS } from './weights';

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

describe('planEdits', () => {
  const originalEnv = {
    EDIT_BUDGET_ENABLED: process.env.EDIT_BUDGET_ENABLED,
    EFFECT_CONFLICT_RESOLUTION_ENABLED: process.env.EFFECT_CONFLICT_RESOLUTION_ENABLED,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('both flags off: suggestions pass through byte-for-byte unchanged, budget still computed', () => {
    delete process.env.EDIT_BUDGET_ENABLED;
    delete process.env.EFFECT_CONFLICT_RESOLUTION_ENABLED;

    const focusShift = suggestion({ technique: 'focus_shift', start: 0, end: 1 });
    const digitalPush = suggestion({ technique: 'digital_push', start: 0.2, end: 0.5 });
    const suggestions = [focusShift, digitalPush];

    const result = planEdits({
      suggestions,
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });

    // .parse() always returns a new array (Zod's own array-parsing behavior), so this asserts
    // value equality, not reference identity - the real guarantee this phase promises.
    expect(result.suggestions).toEqual(suggestions);
    expect(result.decisions).toEqual([]);
    expect(result.budget).toBeDefined();
  });

  it('conflict resolution only: suppresses the overlapping digital_push, budget not enforced', () => {
    delete process.env.EDIT_BUDGET_ENABLED;
    process.env.EFFECT_CONFLICT_RESOLUTION_ENABLED = 'true';

    const focusShift = suggestion({ technique: 'focus_shift', start: 0, end: 1 });
    const digitalPush = suggestion({ technique: 'digital_push', start: 0.2, end: 0.5 });

    const result = planEdits({
      suggestions: [focusShift, digitalPush],
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });

    expect(result.suggestions).toEqual([focusShift]);
    expect(result.decisions).toHaveLength(1);
  });

  it('budget only: drops over-budget suggestions, no conflict resolution applied', () => {
    process.env.EDIT_BUDGET_ENABLED = 'true';
    delete process.env.EFFECT_CONFLICT_RESOLUTION_ENABLED;

    const suggestions = Array.from({ length: 10 }, (_, i) =>
      suggestion({ technique: 'digital_push', start: i * 5, end: i * 5 + 1, score: 0.5 }),
    );

    const result = planEdits({
      suggestions,
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });

    expect(result.suggestions.length).toBeLessThan(suggestions.length);
    expect(result.decisions.every((d) => d.reasonCode === 'over_budget')).toBe(true);
  });

  it('both flags on: conflict resolution runs before budget enforcement', () => {
    process.env.EDIT_BUDGET_ENABLED = 'true';
    process.env.EFFECT_CONFLICT_RESOLUTION_ENABLED = 'true';

    const focusShift = suggestion({ technique: 'focus_shift', start: 0, end: 1, score: 0.9 });
    const overlappingPush = suggestion({
      technique: 'digital_push',
      start: 0.2,
      end: 0.5,
      score: 0.9,
    });

    const result = planEdits({
      suggestions: [focusShift, overlappingPush],
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 2,
      hasVisualInstabilityOrOverEditingRisk: false,
    });

    // The overlapping digital_push is gone via conflict resolution, not budget enforcement -
    // there's plenty of budget headroom for one suggestion, so if it survived resolution it would
    // also survive enforcement.
    expect(result.suggestions).toEqual([focusShift]);
    expect(result.decisions.some((d) => d.reasonCode === 'focus_shift_digital_push_overlap')).toBe(
      true,
    );
  });

  it('never crashes on an empty suggestions array with both flags on', () => {
    process.env.EDIT_BUDGET_ENABLED = 'true';
    process.env.EFFECT_CONFLICT_RESOLUTION_ENABLED = 'true';

    const result = planEdits({
      suggestions: [],
      clipDurationSeconds: BASELINE_CLIP_DURATION_SECONDS,
      speakerCount: 0,
      hasVisualInstabilityOrOverEditingRisk: false,
    });

    expect(result.suggestions).toEqual([]);
    expect(result.decisions).toEqual([]);
  });
});
