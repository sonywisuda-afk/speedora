import type { RetentionPoint } from '@speedora/contracts';
import { fromEmotionalPeaks } from './from-emotional-peaks';

describe('fromEmotionalPeaks', () => {
  it('returns an empty array for an empty emotionalPeaks list', () => {
    expect(fromEmotionalPeaks([])).toEqual([]);
  });

  it('maps every peak onto a reaction_hold suggestion, centered on the peak instant', () => {
    const peaks: RetentionPoint[] = [{ t: 5, score: 0.8 }];
    const result = fromEmotionalPeaks(peaks);

    expect(result).toEqual([
      {
        technique: 'reaction_hold',
        start: 4.25,
        end: 5.75,
        score: 0.8,
        reason: expect.any(String),
      },
    ]);
  });

  it('clamps the window start at 0 for a peak near the clip start', () => {
    const peaks: RetentionPoint[] = [{ t: 0.2, score: 0.5 }];
    const result = fromEmotionalPeaks(peaks);
    expect(result[0].start).toBe(0);
  });
});
