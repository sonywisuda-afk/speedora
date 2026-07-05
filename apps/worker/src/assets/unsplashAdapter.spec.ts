const fetchJsonMock = jest.fn();
jest.mock('./httpClient', () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const fetchMock = jest.fn();
(global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

import { UnsplashAdapter } from './unsplashAdapter';

describe('UnsplashAdapter', () => {
  const originalEnv = process.env.UNSPLASH_ACCESS_KEY;
  const adapter = new UnsplashAdapter();

  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env.UNSPLASH_ACCESS_KEY = originalEnv;
    fetchJsonMock.mockReset();
    fetchMock.mockReset();
  });

  it('has the name "unsplash"', () => {
    expect(adapter.name).toBe('unsplash');
  });

  it('returns null without calling fetchJson when UNSPLASH_ACCESS_KEY is unset', async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;

    expect(await adapter.search('sunset')).toBeNull();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it('sends a Client-ID Authorization header and maps a result to a StockAsset of type "image"', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    fetchJsonMock.mockResolvedValue({
      results: [
        {
          id: 'abc123',
          width: 3000,
          height: 4000,
          urls: {
            regular: 'https://images.unsplash.com/photo-regular.jpg',
            thumb: 'https://images.unsplash.com/photo-thumb.jpg',
          },
          links: { download_location: 'https://api.unsplash.com/photos/abc123/download' },
        },
      ],
    });

    const asset = await adapter.search('sunset');

    expect(asset).toEqual({
      id: 'unsplash-abc123',
      url: 'https://images.unsplash.com/photo-regular.jpg',
      thumbnail: 'https://images.unsplash.com/photo-thumb.jpg',
      sourceName: 'unsplash',
      resolution: { width: 3000, height: 4000 },
      type: 'image',
    });
    const [url, options] = fetchJsonMock.mock.calls[0];
    expect(url).toContain('query=sunset');
    expect((options as { headers: Record<string, string> }).headers.Authorization).toBe(
      'Client-ID test-access-key',
    );
  });

  it('pings the download_location endpoint (API compliance) when a result is chosen', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    fetchJsonMock.mockResolvedValue({
      results: [
        {
          id: 'abc123',
          width: 3000,
          height: 4000,
          urls: {
            regular: 'https://example.com/regular.jpg',
            thumb: 'https://example.com/thumb.jpg',
          },
          links: { download_location: 'https://api.unsplash.com/photos/abc123/download' },
        },
      ],
    });

    await adapter.search('sunset');
    // Fire-and-forget - give the un-awaited promise a tick to run.
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.unsplash.com/photos/abc123/download',
      expect.objectContaining({
        headers: { Authorization: 'Client-ID test-access-key' },
      }),
    );
  });

  it('does not let a failed download-tracking ping reject or affect the returned asset', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    fetchJsonMock.mockResolvedValue({
      results: [
        {
          id: 'abc123',
          width: 3000,
          height: 4000,
          urls: {
            regular: 'https://example.com/regular.jpg',
            thumb: 'https://example.com/thumb.jpg',
          },
          links: { download_location: 'https://api.unsplash.com/photos/abc123/download' },
        },
      ],
    });
    fetchMock.mockRejectedValue(new Error('tracking endpoint down'));

    const asset = await adapter.search('sunset');
    expect(asset?.id).toBe('unsplash-abc123');
  });

  it('returns null when there are no results', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    fetchJsonMock.mockResolvedValue({ results: [] });

    expect(await adapter.search('sunset')).toBeNull();
  });

  it('lets a fetchJson error propagate', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    fetchJsonMock.mockRejectedValue(new Error('rate limited'));

    await expect(adapter.search('sunset')).rejects.toThrow('rate limited');
  });
});
