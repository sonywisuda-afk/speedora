import type { RetentionPoint, TranscriptWordInput } from '@speedora/contracts';
import { fromPauses } from './from-pauses';

// A 2s gap (well above cutlist's own 0.7s "worth cutting" threshold)
// between two words - computeSilenceCuts() turns this into one cut range
// padded by 0.15s at each edge: { start: 1.15, end: 2.85 }.
const WORDS: TranscriptWordInput[] = [
  { word: 'before', start: 0, end: 1 },
  { word: 'after', start: 3, end: 4 },
];
const CLIP_DURATION = 4;

describe('fromPauses', () => {
  it('returns an empty array when there are no pause gaps at all', () => {
    const contiguousWords: TranscriptWordInput[] = [
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 1, end: 2 },
    ];
    const result = fromPauses(contiguousWords, 2, [{ t: 1, score: 0.9 }], []);
    expect(result).toEqual([]);
  });

  it('does not suggest pause_hold when no Retention Curve Insights point is nearby', () => {
    const result = fromPauses(WORDS, CLIP_DURATION, [], []);
    expect(result).toEqual([]);
  });

  it('suggests pause_hold when a curiosityPeak lands near the gap', () => {
    const curiosityPeaks: RetentionPoint[] = [{ t: 2, score: 0.7 }];
    const result = fromPauses(WORDS, CLIP_DURATION, curiosityPeaks, []);

    expect(result).toEqual([
      {
        technique: 'pause_hold',
        start: 1.15,
        end: 2.85,
        score: 0.7,
        reason: expect.stringContaining('curiosity'),
      },
    ]);
  });

  it('suggests pause_hold when a dropPoint lands near the gap', () => {
    const dropPoints: RetentionPoint[] = [{ t: 2, score: 0.6 }];
    const result = fromPauses(WORDS, CLIP_DURATION, [], dropPoints);
    expect(result[0].reason).toContain('drop-off');
  });

  it('picks the higher-scoring point when both a curiosityPeak and a dropPoint are nearby', () => {
    const result = fromPauses(
      WORDS,
      CLIP_DURATION,
      [{ t: 2, score: 0.4 }],
      [{ t: 2.1, score: 0.9 }],
    );
    expect(result[0].score).toBe(0.9);
    expect(result[0].reason).toContain('drop-off');
  });

  it('does not suggest when the point is far outside the proximity window', () => {
    const result = fromPauses(WORDS, CLIP_DURATION, [{ t: 100, score: 0.9 }], []);
    expect(result).toEqual([]);
  });
});
