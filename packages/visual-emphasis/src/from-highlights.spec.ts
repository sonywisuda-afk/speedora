import type { HighlightMoment } from '@speedora/contracts';
import { fromHighlights } from './from-highlights';

function highlight(start: number, end: number, score: number): HighlightMoment {
  return { start, end, score };
}

describe('fromHighlights', () => {
  it('returns an empty array for an empty HighlightTimeline', () => {
    expect(fromHighlights([])).toEqual([]);
  });

  it('maps every highlight 1:1 onto a digital_push suggestion, preserving start/end/score', () => {
    const highlights = [highlight(1, 2, 0.7), highlight(5, 6, 0.9)];
    const result = fromHighlights(highlights);

    expect(result).toEqual([
      { technique: 'digital_push', start: 1, end: 2, score: 0.7, reason: expect.any(String) },
      { technique: 'digital_push', start: 5, end: 6, score: 0.9, reason: expect.any(String) },
    ]);
  });
});
