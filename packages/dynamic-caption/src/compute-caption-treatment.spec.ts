import type {
  ComputeCaptionTreatmentInput,
  EmotionalArcSample,
  HighlightMoment,
  SubtitleLine,
} from '@speedora/contracts';
import { computeCaptionTreatment } from './compute-caption-treatment';

function line(start: number, end: number, text = 'test line'): SubtitleLine {
  return { start, end, text, words: [], emphasisWordIndices: [] };
}

function emotion(t: number, intensity: number): EmotionalArcSample {
  return { t, emotion: 'hap', intensity };
}

function highlight(start: number, end: number, score = 0.8): HighlightMoment {
  return { start, end, score };
}

function baseInput(
  overrides: Partial<ComputeCaptionTreatmentInput> = {},
): ComputeCaptionTreatmentInput {
  return {
    timeline: [],
    highlights: [],
    emotionalArc: [],
    ...overrides,
  };
}

describe('computeCaptionTreatment', () => {
  it('returns an empty array for an empty timeline', () => {
    expect(computeCaptionTreatment(baseInput())).toEqual([]);
  });

  it('produces exactly one treatment per line, dense (not filtered)', () => {
    const timeline = [line(0, 1), line(1, 2), line(2, 3)];
    const result = computeCaptionTreatment(baseInput({ timeline }));
    expect(result).toHaveLength(3);
    expect(result.map((r) => [r.start, r.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  describe('sizeTier', () => {
    it('is "normal" when there is no emotional arc data at all', () => {
      const timeline = [line(0, 1)];
      const result = computeCaptionTreatment(baseInput({ timeline }));
      expect(result[0].sizeTier).toBe('normal');
    });

    it('is "large" when the nearest emotional intensity clears the high threshold', () => {
      const timeline = [line(0, 1)];
      const emotionalArc = [emotion(0, 0.9)];
      const result = computeCaptionTreatment(baseInput({ timeline, emotionalArc }));
      expect(result[0].sizeTier).toBe('large');
    });

    it('is "small" when the nearest emotional intensity is at or below the low threshold', () => {
      const timeline = [line(0, 1)];
      const emotionalArc = [emotion(0, 0.05)];
      const result = computeCaptionTreatment(baseInput({ timeline, emotionalArc }));
      expect(result[0].sizeTier).toBe('small');
    });

    it('is "normal" for a mid-range intensity', () => {
      const timeline = [line(0, 1)];
      const emotionalArc = [emotion(0, 0.4)];
      const result = computeCaptionTreatment(baseInput({ timeline, emotionalArc }));
      expect(result[0].sizeTier).toBe('normal');
    });

    it('uses the temporally-nearest sample, not necessarily an exact time match', () => {
      const timeline = [line(10, 11)];
      const emotionalArc = [emotion(0, 0.1), emotion(9.8, 0.9)];
      const result = computeCaptionTreatment(baseInput({ timeline, emotionalArc }));
      expect(result[0].sizeTier).toBe('large');
    });
  });

  describe('animation', () => {
    it('is "none" when the line overlaps no highlight and does not end in a question', () => {
      const timeline = [line(0, 1, 'a plain statement.')];
      const result = computeCaptionTreatment(baseInput({ timeline }));
      expect(result[0].animation).toBe('none');
    });

    it('is "punch" when the line overlaps a HighlightTimeline moment', () => {
      const timeline = [line(0, 2)];
      const highlights = [highlight(0.5, 1.5)];
      const result = computeCaptionTreatment(baseInput({ timeline, highlights }));
      expect(result[0].animation).toBe('punch');
    });

    it('is "attention" when the line ends in a question mark and does not overlap a highlight', () => {
      const timeline = [line(0, 1, 'is this real?')];
      const result = computeCaptionTreatment(baseInput({ timeline }));
      expect(result[0].animation).toBe('attention');
    });

    it('prefers "punch" over "attention" when both conditions apply', () => {
      const timeline = [line(0, 2, 'is this real?')];
      const highlights = [highlight(0.5, 1.5)];
      const result = computeCaptionTreatment(baseInput({ timeline, highlights }));
      expect(result[0].animation).toBe('punch');
    });

    it('does not treat a highlight outside the line window as an overlap', () => {
      const timeline = [line(0, 1)];
      const highlights = [highlight(5, 6)];
      const result = computeCaptionTreatment(baseInput({ timeline, highlights }));
      expect(result[0].animation).toBe('none');
    });
  });

  describe('animation cooldown ("do not overuse animation")', () => {
    it('downgrades a second animated line to "none" when it lands within the cooldown window', () => {
      const timeline = [line(0, 1, 'shocking?'), line(1, 2, 'another one?')];
      const result = computeCaptionTreatment(baseInput({ timeline }));
      expect(result[0].animation).toBe('attention');
      expect(result[1].animation).toBe('none');
    });

    it('allows a second animated line once the cooldown window has passed', () => {
      const timeline = [line(0, 1, 'shocking?'), line(10, 11, 'another one?')];
      const result = computeCaptionTreatment(baseInput({ timeline }));
      expect(result[0].animation).toBe('attention');
      expect(result[1].animation).toBe('attention');
    });

    it('does not consume cooldown budget for a "none" line in between', () => {
      const timeline = [line(0, 1, 'shocking?'), line(1, 2, 'plain.'), line(1, 5, 'another?')];
      const result = computeCaptionTreatment(baseInput({ timeline }));
      expect(result[0].animation).toBe('attention');
      expect(result[1].animation).toBe('none');
      // Still within the cooldown window measured from the FIRST animated
      // line (t=0), not reset by the intervening plain line.
      expect(result[2].animation).toBe('none');
    });
  });
});
