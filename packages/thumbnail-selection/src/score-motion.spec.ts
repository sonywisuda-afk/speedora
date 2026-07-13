import { scoreMotion } from './score-motion';

describe('scoreMotion', () => {
  it('returns an empty map for null/empty samples', () => {
    expect(scoreMotion(null, null).size).toBe(0);
    expect(scoreMotion([], null).size).toBe(0);
  });

  it('returns an empty map for a perfectly flat signal (stddev 0)', () => {
    const samples = [
      { t: 0, motionEnergy: 5 },
      { t: 1, motionEnergy: 5 },
      { t: 2, motionEnergy: 5 },
    ];
    expect(scoreMotion(samples, null).size).toBe(0);
  });

  it('scores a local peak that clears mean + stddev*multiplier', () => {
    const samples = [
      { t: 0, motionEnergy: 1 },
      { t: 1, motionEnergy: 1 },
      { t: 2, motionEnergy: 20 },
      { t: 3, motionEnergy: 1 },
      { t: 4, motionEnergy: 1 },
    ];
    const scores = scoreMotion(samples, null);
    expect(scores.get(2)).toBe(1);
    expect(scores.size).toBe(1);
  });

  it('excludes a peak within MIN_CUT_DISTANCE_SECONDS of a scene cut', () => {
    const samples = [
      { t: 0, motionEnergy: 1 },
      { t: 1, motionEnergy: 1 },
      { t: 2, motionEnergy: 20 },
      { t: 3, motionEnergy: 1 },
      { t: 4, motionEnergy: 1 },
    ];
    const scores = scoreMotion(samples, [{ t: 2.2, type: 'hard_cut' }]);
    expect(scores.size).toBe(0);
  });
});
