import { deriveCaptionQuality } from './derive-caption-quality';

describe('deriveCaptionQuality', () => {
  it('always returns an unavailable, null-score result - no detector exists', () => {
    const result = deriveCaptionQuality();
    expect(result.score).toBeNull();
    expect(result.basis).toBe('unavailable');
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
