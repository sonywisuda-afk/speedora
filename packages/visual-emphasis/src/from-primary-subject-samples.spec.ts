import type { PrimarySubjectSample } from '@speedora/contracts';
import { fromPrimarySubjectSamples } from './from-primary-subject-samples';

function sample(t: number, trackId: number | null): PrimarySubjectSample {
  return {
    t,
    trackId,
    box: trackId !== null ? { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 } : null,
    facingYaw: null,
    source: trackId !== null ? 'face' : null,
  };
}

describe('fromPrimarySubjectSamples', () => {
  it('returns an empty array for an empty sample list', () => {
    expect(fromPrimarySubjectSamples([])).toEqual([]);
  });

  it('returns an empty array when the same trackId is held throughout', () => {
    const samples = [sample(0, 1), sample(1, 1), sample(2, 1)];
    expect(fromPrimarySubjectSamples(samples)).toEqual([]);
  });

  it('suggests focus_shift when trackId changes after a long-enough hold', () => {
    // Subject 1 held from t=0 to t=2 (2s, above the 1.0s minimum), then
    // switches to subject 2.
    const samples = [sample(0, 1), sample(1, 1), sample(2, 2), sample(3, 2)];
    const result = fromPrimarySubjectSamples(samples);

    expect(result).toHaveLength(1);
    expect(result[0].technique).toBe('focus_shift');
    expect(result[0].start).toBeCloseTo(1.85);
    expect(result[0].end).toBeCloseTo(2.15);
    // held = 2s, normalization = 3s -> score = 2/3.
    expect(result[0].score).toBeCloseTo(2 / 3);
  });

  it('does not suggest when the hold before the change is too short (tracker flicker)', () => {
    const samples = [sample(0, 1), sample(0.3, 2)];
    expect(fromPrimarySubjectSamples(samples)).toEqual([]);
  });

  it('does not suggest a shift into or out of null (no subject detected)', () => {
    const samples = [sample(0, 1), sample(2, null), sample(4, 2)];
    expect(fromPrimarySubjectSamples(samples)).toEqual([]);
  });

  it('caps score at 1.0 for a hold well beyond the normalization window', () => {
    const samples = [sample(0, 1), sample(10, 2)];
    const result = fromPrimarySubjectSamples(samples);
    expect(result[0].score).toBe(1);
  });

  it('suggests multiple shifts across several real subject changes', () => {
    const samples = [sample(0, 1), sample(2, 2), sample(4, 3)];
    const result = fromPrimarySubjectSamples(samples);
    expect(result).toHaveLength(2);
  });
});
