import type { RetentionPoint } from '@speedora/contracts';
import { fromDropPoints } from './from-drop-points';

describe('fromDropPoints', () => {
  it('returns an empty array for an empty dropPoints list', () => {
    expect(fromDropPoints([], 30)).toEqual([]);
  });

  it('filters out drop points below the severity threshold', () => {
    const dropPoints: RetentionPoint[] = [{ t: 5, score: 0.5 }];
    expect(fromDropPoints(dropPoints, 30)).toEqual([]);
  });

  it('maps a sufficiently severe drop point onto an attention_cut suggestion, centered on the drop instant', () => {
    const dropPoints: RetentionPoint[] = [{ t: 7, score: 0.8 }];
    const result = fromDropPoints(dropPoints, 30);

    expect(result).toEqual([
      {
        technique: 'attention_cut',
        start: 5.75,
        end: 8.25,
        score: 0.8,
        reason: expect.any(String),
      },
    ]);
  });

  it('clamps the window start at 0 for a drop point near the clip start', () => {
    const dropPoints: RetentionPoint[] = [{ t: 0.2, score: 0.9 }];
    expect(fromDropPoints(dropPoints, 30)[0].start).toBe(0);
  });

  it('clamps the window end at clipDurationSeconds for a drop point near the clip end', () => {
    const dropPoints: RetentionPoint[] = [{ t: 29.9, score: 0.9 }];
    expect(fromDropPoints(dropPoints, 30)[0].end).toBe(30);
  });

  it('includes a drop point exactly at the severity threshold', () => {
    const dropPoints: RetentionPoint[] = [{ t: 5, score: 0.6 }];
    expect(fromDropPoints(dropPoints, 30)).toHaveLength(1);
  });

  it('maps multiple qualifying drop points independently', () => {
    const dropPoints: RetentionPoint[] = [
      { t: 5, score: 0.6 },
      { t: 15, score: 0.8 },
    ];
    const result = fromDropPoints(dropPoints, 30);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.technique)).toEqual(['attention_cut', 'attention_cut']);
  });
});
