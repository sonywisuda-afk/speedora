import {
  computeCutJunctionTimestamps,
  computeFillerCuts,
  computeSilenceCuts,
  mergeCutRanges,
  totalCutSeconds,
} from './cutlist';

describe('computeSilenceCuts', () => {
  it('returns no cuts at all when there is no word-level data, even for a long clip', () => {
    // A regression case: with zero words, the trailing-gap check must not
    // fall through and treat the whole clip as one giant cut.
    expect(computeSilenceCuts([], 45)).toEqual([]);
  });

  it('returns no cuts when every gap (including trailing) is a normal speech pause', () => {
    const words = [
      { word: 'hello', start: 0, end: 0.5 },
      { word: 'there', start: 0.7, end: 1.1 }, // 0.2s gap
    ];
    // Clip ends at 1.3s - trailing gap is 0.2s, also under the threshold.
    expect(computeSilenceCuts(words, 1.3)).toEqual([]);
  });

  it('cuts a long gap between two words, padded at each edge', () => {
    const words = [
      { word: 'hello', start: 0, end: 0.5 },
      { word: 'there', start: 3, end: 3.4 }, // 2.5s gap - well over the 0.7s threshold
    ];
    expect(computeSilenceCuts(words, 4)).toEqual([{ start: 0.65, end: 2.85 }]);
  });

  it('cuts trailing silence after the last word if long enough', () => {
    const words = [{ word: 'done', start: 0, end: 0.4 }];
    // Clip runs to 3s, last word ends at 0.4s -> 2.6s of trailing silence.
    expect(computeSilenceCuts(words, 3)).toEqual([{ start: 0.55, end: 3 }]);
  });

  it('does not cut trailing silence shorter than the threshold', () => {
    const words = [{ word: 'done', start: 0, end: 0.4 }];
    expect(computeSilenceCuts(words, 0.8)).toEqual([]);
  });

  it('sorts unsorted input before computing gaps', () => {
    const words = [
      { word: 'there', start: 3, end: 3.4 },
      { word: 'hello', start: 0, end: 0.5 },
    ];
    expect(computeSilenceCuts(words, 4)).toEqual([{ start: 0.65, end: 2.85 }]);
  });

  it('treats overlapping words as one continuous span (no negative gap)', () => {
    const words = [
      { word: 'over', start: 0, end: 1 },
      { word: 'lap', start: 0.5, end: 1.5 }, // overlaps the previous word
    ];
    expect(computeSilenceCuts(words, 1.6)).toEqual([]);
  });
});

describe('computeFillerCuts', () => {
  it('cuts each um/uh-family word exactly, no edge padding', () => {
    const words = [
      { word: 'so', start: 0, end: 0.3 },
      { word: 'um', start: 0.3, end: 0.6 },
      { word: 'yeah', start: 0.6, end: 1 },
    ];
    expect(computeFillerCuts(words)).toEqual([{ start: 0.3, end: 0.6 }]);
  });

  it('is case-insensitive and strips punctuation before matching', () => {
    const words = [
      { word: 'Uh,', start: 0, end: 0.3 },
      { word: 'UMM', start: 0.3, end: 0.6 },
    ];
    expect(computeFillerCuts(words)).toEqual([
      { start: 0, end: 0.3 },
      { start: 0.3, end: 0.6 },
    ]);
  });

  it('does NOT treat legitimate words like "like" or "so" as fillers', () => {
    const words = [
      { word: 'I', start: 0, end: 0.2 },
      { word: 'like', start: 0.2, end: 0.4 },
      { word: 'this', start: 0.4, end: 0.6 },
      { word: 'so', start: 0.6, end: 0.8 },
      { word: 'much', start: 0.8, end: 1 },
    ];
    expect(computeFillerCuts(words)).toEqual([]);
  });
});

describe('mergeCutRanges', () => {
  it('sorts and merges overlapping ranges', () => {
    expect(
      mergeCutRanges([
        { start: 5, end: 8 },
        { start: 0, end: 2 },
        { start: 1.5, end: 4 },
      ]),
    ).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 8 },
    ]);
  });

  it('merges adjacent (touching) ranges into one', () => {
    expect(
      mergeCutRanges([
        { start: 0, end: 2 },
        { start: 2, end: 3 },
      ]),
    ).toEqual([{ start: 0, end: 3 }]);
  });

  it('drops degenerate/inverted ranges', () => {
    expect(
      mergeCutRanges([
        { start: 5, end: 5 },
        { start: 6, end: 4 },
      ]),
    ).toEqual([]);
  });

  it('returns an empty array for no cuts', () => {
    expect(mergeCutRanges([])).toEqual([]);
  });
});

describe('totalCutSeconds', () => {
  it('sums the duration of every range', () => {
    expect(
      totalCutSeconds([
        { start: 0, end: 2 },
        { start: 5, end: 8 },
      ]),
    ).toBe(5);
  });

  it('returns 0 for no ranges', () => {
    expect(totalCutSeconds([])).toBe(0);
  });
});

describe('computeCutJunctionTimestamps', () => {
  it('returns the single cut start unshifted when there is only one cut', () => {
    expect(computeCutJunctionTimestamps([{ start: 5, end: 7 }])).toEqual([5]);
  });

  it("shifts each later junction back by every earlier cut's total duration", () => {
    // Cut 1 removes 2s (5-7); cut 2's junction on the OUTPUT timeline is
    // where content becomes discontinuous once cut 1 already collapsed the
    // timeline before it - its raw start (10) minus that 2s.
    const junctions = computeCutJunctionTimestamps([
      { start: 5, end: 7 },
      { start: 10, end: 10.5 },
    ]);

    expect(junctions).toEqual([5, 8]);
  });

  it('compounds across three or more cuts', () => {
    const junctions = computeCutJunctionTimestamps([
      { start: 2, end: 3 }, // removes 1s
      { start: 6, end: 6.5 }, // removes 0.5s
      { start: 20, end: 21 }, // removes 1s
    ]);

    // Junction 1: 2 (nothing removed yet).
    // Junction 2: 6 - 1 = 5.
    // Junction 3: 20 - 1.5 = 18.5.
    expect(junctions).toEqual([2, 5, 18.5]);
  });

  it('returns an empty array for no cuts', () => {
    expect(computeCutJunctionTimestamps([])).toEqual([]);
  });
});
