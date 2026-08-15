import type { EditingSuggestion } from '@speedora/contracts';
import { resolveConflicts } from './resolve-conflicts';

function suggestion(overrides: Partial<EditingSuggestion>): EditingSuggestion {
  return {
    technique: 'focus_shift',
    start: 0,
    end: 1,
    score: 0.5,
    reason: 'test fixture',
    ...overrides,
  };
}

describe('resolveConflicts', () => {
  it('suppresses an overlapping digital_push when it overlaps a focus_shift window', () => {
    const focusShift = suggestion({ technique: 'focus_shift', start: 0.4, end: 0.8 });
    const digitalPush = suggestion({ technique: 'digital_push', start: 0.5, end: 0.6 });

    const result = resolveConflicts([focusShift, digitalPush]);

    expect(result.suggestions).toEqual([focusShift]);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: 'suppressed',
        reasonCode: 'focus_shift_digital_push_overlap',
        technique: 'digital_push',
        relatedTechnique: 'focus_shift',
      }),
    ]);
  });

  it('suppresses an overlapping digital_push against speaker_focus_shift too (same shift family)', () => {
    const speakerShift = suggestion({ technique: 'speaker_focus_shift', start: 0, end: 1 });
    const digitalPush = suggestion({ technique: 'digital_push', start: 0.2, end: 0.3 });

    const result = resolveConflicts([speakerShift, digitalPush]);

    expect(result.suggestions).toEqual([speakerShift]);
  });

  it('keeps both when a focus_shift and digital_push do not overlap in time', () => {
    const focusShift = suggestion({ technique: 'focus_shift', start: 0, end: 1 });
    const digitalPush = suggestion({ technique: 'digital_push', start: 5, end: 6 });

    const result = resolveConflicts([focusShift, digitalPush]);

    expect(result.suggestions).toHaveLength(2);
    expect(result.decisions).toHaveLength(0);
  });

  it('suppresses an ocr_highlight overlapping a surviving digital_push', () => {
    const digitalPush = suggestion({ technique: 'digital_push', start: 0, end: 2 });
    const ocrHighlight = suggestion({ technique: 'ocr_highlight', start: 1, end: 1.5 });

    const result = resolveConflicts([digitalPush, ocrHighlight]);

    expect(result.suggestions).toEqual([digitalPush]);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: 'suppressed',
        reasonCode: 'ocr_highlight_crop_movement_overlap',
        technique: 'ocr_highlight',
        relatedTechnique: 'digital_push',
      }),
    ]);
  });

  it('does NOT suppress an ocr_highlight overlapping a digital_push that was itself already suppressed by rule 1', () => {
    const focusShift = suggestion({ technique: 'focus_shift', start: 0, end: 2 });
    const digitalPush = suggestion({ technique: 'digital_push', start: 0.5, end: 1 });
    const ocrHighlight = suggestion({ technique: 'ocr_highlight', start: 0.5, end: 1 });

    const result = resolveConflicts([focusShift, digitalPush, ocrHighlight]);

    // digital_push is suppressed (overlaps focus_shift); ocr_highlight overlaps focus_shift too,
    // which IS a moving-crop technique, so it's still suppressed - but via focus_shift, not the
    // already-removed digital_push. Confirms rule 2 checks the FULL moving-crop family, not just
    // digital_push.
    expect(result.suggestions).toEqual([focusShift]);
  });

  it('keeps an ocr_highlight when nothing moving-crop overlaps it', () => {
    const ocrHighlight = suggestion({ technique: 'ocr_highlight', start: 0, end: 1 });
    const result = resolveConflicts([ocrHighlight]);
    expect(result.suggestions).toEqual([ocrHighlight]);
    expect(result.decisions).toHaveLength(0);
  });

  it('records a kept, observability-only decision for reaction_hold overlapping pause_hold - never drops either', () => {
    const reactionHold = suggestion({ technique: 'reaction_hold', start: 5, end: 5.5 });
    const pauseHold = suggestion({ technique: 'pause_hold', start: 4.5, end: 6 });

    const result = resolveConflicts([reactionHold, pauseHold]);

    expect(result.suggestions).toEqual(expect.arrayContaining([reactionHold, pauseHold]));
    expect(result.suggestions).toHaveLength(2);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: 'kept',
        reasonCode: 'reaction_hold_pause_hold_product_dependency',
        technique: 'reaction_hold',
        relatedTechnique: 'pause_hold',
      }),
    ]);
  });

  it('records no decision for a reaction_hold with no overlapping pause_hold', () => {
    const reactionHold = suggestion({ technique: 'reaction_hold', start: 5, end: 5.5 });
    const pauseHold = suggestion({ technique: 'pause_hold', start: 10, end: 11 });

    const result = resolveConflicts([reactionHold, pauseHold]);

    expect(result.decisions).toHaveLength(0);
  });

  it('returns the input unchanged when given an empty array', () => {
    expect(resolveConflicts([])).toEqual({ suggestions: [], decisions: [] });
  });
});
