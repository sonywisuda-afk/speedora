import { deriveEditorialQuality } from './derive-editorial-quality';

describe('deriveEditorialQuality', () => {
  it('returns the editorialScore directly as a measured dimension', () => {
    const result = deriveEditorialQuality({ editorialScore: 72 });
    expect(result).toEqual({
      score: 72,
      basis: 'measured',
      notes: expect.stringContaining('editorialScore'),
    });
  });

  it('returns unavailable when editorialScore is null', () => {
    const result = deriveEditorialQuality({ editorialScore: null });
    expect(result.score).toBeNull();
    expect(result.basis).toBe('unavailable');
  });
});
