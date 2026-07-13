import { scoreGesture } from './score-gesture';

describe('scoreGesture', () => {
  it('returns an empty map for null input', () => {
    expect(scoreGesture(null).size).toBe(0);
  });

  it('scores a named gesture by its own confidence', () => {
    const scores = scoreGesture([{ t: 1, gesture: 'thumb_up', confidence: 0.7 }]);
    expect(scores.get(1)).toBe(0.7);
  });

  it('ignores "none" and null gesture samples', () => {
    const scores = scoreGesture([
      { t: 1, gesture: 'none', confidence: 0.9 },
      { t: 2, gesture: null, confidence: null },
    ]);
    expect(scores.size).toBe(0);
  });
});
