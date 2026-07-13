import type { PrimarySubjectSample } from '@speedora/contracts';
import { scoreComposition } from './score-composition';

function sample(overrides: Partial<PrimarySubjectSample> = {}): PrimarySubjectSample {
  return {
    t: 0,
    box: { xCenter: 1 / 3, yCenter: 1 / 3, width: 0.2, height: 0.3 },
    trackId: 1,
    facingYaw: null,
    source: 'face',
    ...overrides,
  };
}

describe('scoreComposition', () => {
  it('returns an empty map for null input', () => {
    expect(scoreComposition(null).size).toBe(0);
  });

  it('excludes samples with no subject box', () => {
    const scores = scoreComposition([sample({ t: 1, box: null })]);
    expect(scores.has(1)).toBe(false);
  });

  it('scores a subject exactly on a thirds intersection at 1', () => {
    const scores = scoreComposition([sample({ t: 1 })]);
    expect(scores.get(1)).toBeCloseTo(1);
  });

  it('scores a dead-center subject lower than a thirds-aligned one', () => {
    const centered = scoreComposition([
      sample({ t: 1, box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 } }),
    ]);
    const thirdsAligned = scoreComposition([sample({ t: 1 })]);
    expect(centered.get(1)!).toBeLessThan(thirdsAligned.get(1)!);
  });
});
