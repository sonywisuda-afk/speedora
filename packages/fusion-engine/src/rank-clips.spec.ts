import { rankClips } from './rank-clips';

describe('rankClips', () => {
  it('ranks clips by highlightScore descending, rank 1 = highest', () => {
    const result = rankClips([
      { clipId: 'a', highlightScore: 50 },
      { clipId: 'b', highlightScore: 80 },
      { clipId: 'c', highlightScore: 30 },
    ]);
    expect(result).toEqual([
      { clipId: 'b', highlightScore: 80, rank: 1 },
      { clipId: 'a', highlightScore: 50, rank: 2 },
      { clipId: 'c', highlightScore: 30, rank: 3 },
    ]);
  });

  it('ranks clips with a null highlightScore last, after every scored clip', () => {
    const result = rankClips([
      { clipId: 'a', highlightScore: null },
      { clipId: 'b', highlightScore: 40 },
    ]);
    expect(result).toEqual([
      { clipId: 'b', highlightScore: 40, rank: 1 },
      { clipId: 'a', highlightScore: null, rank: 2 },
    ]);
  });

  it('keeps the original relative order among multiple null-score clips (stable sort)', () => {
    const result = rankClips([
      { clipId: 'a', highlightScore: null },
      { clipId: 'b', highlightScore: null },
    ]);
    expect(result.map((clip) => clip.clipId)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [
      { clipId: 'a', highlightScore: 10 },
      { clipId: 'b', highlightScore: 90 },
    ];
    rankClips(input);
    expect(input).toEqual([
      { clipId: 'a', highlightScore: 10 },
      { clipId: 'b', highlightScore: 90 },
    ]);
  });
});
