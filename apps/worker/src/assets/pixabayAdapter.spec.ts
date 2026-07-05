const fetchJsonMock = jest.fn();
jest.mock('./httpClient', () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { PixabayAdapter } from './pixabayAdapter';

describe('PixabayAdapter', () => {
  const originalEnv = process.env.PIXABAY_API_KEY;
  const adapter = new PixabayAdapter();

  afterEach(() => {
    process.env.PIXABAY_API_KEY = originalEnv;
    fetchJsonMock.mockReset();
  });

  it('has the name "pixabay"', () => {
    expect(adapter.name).toBe('pixabay');
  });

  it('returns null without calling fetchJson when PIXABAY_API_KEY is unset', async () => {
    delete process.env.PIXABAY_API_KEY;

    expect(await adapter.search('sunset')).toBeNull();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it('sends the key + query (with per_page=3, the API minimum) and maps the smallest variant >= 480px wide', async () => {
    process.env.PIXABAY_API_KEY = 'test-key';
    fetchJsonMock.mockResolvedValue({
      hits: [
        {
          id: 42,
          videos: {
            large: {
              url: 'https://example.com/large.mp4',
              width: 1920,
              height: 1080,
              thumbnail: 'https://example.com/large.jpg',
            },
            medium: {
              url: 'https://example.com/medium.mp4',
              width: 1280,
              height: 720,
              thumbnail: 'https://example.com/medium.jpg',
            },
            small: {
              url: 'https://example.com/small.mp4',
              width: 960,
              height: 540,
              thumbnail: 'https://example.com/small.jpg',
            },
            tiny: {
              url: 'https://example.com/tiny.mp4',
              width: 640,
              height: 360,
              thumbnail: 'https://example.com/tiny.jpg',
            },
          },
        },
      ],
    });

    const asset = await adapter.search('sunset');

    expect(asset).toEqual({
      id: 'pixabay-42',
      url: 'https://example.com/tiny.mp4',
      thumbnail: 'https://example.com/tiny.jpg',
      sourceName: 'pixabay',
      resolution: { width: 640, height: 360 },
      type: 'video',
    });
    const [url] = fetchJsonMock.mock.calls[0];
    expect(url).toContain('key=test-key');
    expect(url).toContain('q=sunset');
    expect(url).toContain('per_page=3');
  });

  it('falls back to the largest available variant when none meet the minimum width', async () => {
    process.env.PIXABAY_API_KEY = 'test-key';
    fetchJsonMock.mockResolvedValue({
      hits: [
        {
          id: 7,
          videos: {
            small: {
              url: 'https://example.com/small.mp4',
              width: 200,
              height: 112,
              thumbnail: 'https://example.com/small.jpg',
            },
            tiny: {
              url: 'https://example.com/tiny.mp4',
              width: 100,
              height: 56,
              thumbnail: 'https://example.com/tiny.jpg',
            },
          },
        },
      ],
    });

    const asset = await adapter.search('sunset');
    expect(asset?.url).toBe('https://example.com/small.mp4');
  });

  it('returns null when there are no hits', async () => {
    process.env.PIXABAY_API_KEY = 'test-key';
    fetchJsonMock.mockResolvedValue({ hits: [] });

    expect(await adapter.search('sunset')).toBeNull();
  });

  it('lets a fetchJson error propagate', async () => {
    process.env.PIXABAY_API_KEY = 'test-key';
    fetchJsonMock.mockRejectedValue(new Error('rate limited'));

    await expect(adapter.search('sunset')).rejects.toThrow('rate limited');
  });
});
