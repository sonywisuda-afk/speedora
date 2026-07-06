import { computeSpeakingRate } from './speaking-rate';

describe('computeSpeakingRate', () => {
  it('computes words per second for a normal segment', () => {
    expect(computeSpeakingRate({ segmentStart: 0, segmentEnd: 5, wordCount: 10 })).toEqual({
      wordsPerSecond: 2,
    });
  });

  it('handles a fractional duration', () => {
    const result = computeSpeakingRate({ segmentStart: 10, segmentEnd: 12.5, wordCount: 5 });
    expect(result.wordsPerSecond).toBeCloseTo(2, 5);
  });

  it('returns 0 for a zero-duration segment rather than dividing by zero', () => {
    expect(computeSpeakingRate({ segmentStart: 5, segmentEnd: 5, wordCount: 3 })).toEqual({
      wordsPerSecond: 0,
    });
  });

  it('returns 0 for a segment with no words', () => {
    expect(computeSpeakingRate({ segmentStart: 0, segmentEnd: 5, wordCount: 0 })).toEqual({
      wordsPerSecond: 0,
    });
  });

  it('rejects a malformed input against the speakingRateInputSchema contract', () => {
    expect(() => computeSpeakingRate({} as never)).toThrow();
  });
});
