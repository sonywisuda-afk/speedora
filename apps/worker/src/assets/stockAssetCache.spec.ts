import { StockAssetCache } from './stockAssetCache';

describe('StockAssetCache', () => {
  it('returns undefined for a key that was never set (a genuine cache miss)', () => {
    const cache = new StockAssetCache<string>();
    expect(cache.get('sunset')).toBeUndefined();
  });

  it('returns a previously set value before it expires', () => {
    const cache = new StockAssetCache<string>(1000);
    cache.set('sunset', 'https://example.com/sunset.mp4');

    expect(cache.get('sunset')).toBe('https://example.com/sunset.mp4');
  });

  it('caches null itself as a real value, distinct from a miss', () => {
    const cache = new StockAssetCache<string | null>(1000);
    cache.set('nonexistent-keyword', null);

    expect(cache.get('nonexistent-keyword')).toBeNull();
  });

  it('expires an entry once its TTL has elapsed', () => {
    jest.useFakeTimers();
    try {
      const cache = new StockAssetCache<string>(1000);
      cache.set('sunset', 'https://example.com/sunset.mp4');

      jest.advanceTimersByTime(1001);

      expect(cache.get('sunset')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
