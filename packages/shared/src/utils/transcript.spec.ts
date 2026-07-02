import { filterSegmentsForClip } from './transcript';

describe('filterSegmentsForClip', () => {
  const segments = [
    { start: 0, end: 5, text: 'before' },
    { start: 8, end: 15, text: 'inside' },
    { start: 25, end: 30, text: 'after' },
  ];

  it('keeps segments that overlap the clip window', () => {
    expect(filterSegmentsForClip(segments, 10, 20)).toEqual([
      { start: 8, end: 15, text: 'inside' },
    ]);
  });

  it('drops segments entirely before or after the clip window', () => {
    expect(filterSegmentsForClip(segments, 10, 20).map((s) => s.text)).not.toContain('before');
    expect(filterSegmentsForClip(segments, 10, 20).map((s) => s.text)).not.toContain('after');
  });

  it('treats a segment that only touches the boundary as non-overlapping', () => {
    expect(filterSegmentsForClip(segments, 5, 8)).toEqual([]);
  });

  it('returns an empty array when nothing overlaps', () => {
    expect(filterSegmentsForClip(segments, 100, 200)).toEqual([]);
  });

  it('returns an empty array for an empty segment list', () => {
    expect(filterSegmentsForClip([], 0, 10)).toEqual([]);
  });
});
