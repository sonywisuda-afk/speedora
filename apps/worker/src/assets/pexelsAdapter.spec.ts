const fetchJsonMock = jest.fn();
jest.mock('./httpClient', () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { PexelsAdapter } from './pexelsAdapter';

describe('PexelsAdapter', () => {
  const originalEnv = process.env.PEXELS_API_KEY;
  const adapter = new PexelsAdapter();

  afterEach(() => {
    process.env.PEXELS_API_KEY = originalEnv;
    fetchJsonMock.mockReset();
  });

  it('has the name "pexels"', () => {
    expect(adapter.name).toBe('pexels');
  });

  it('returns null without calling fetchJson when PEXELS_API_KEY is unset', async () => {
    delete process.env.PEXELS_API_KEY;

    expect(await adapter.search('sunset')).toBeNull();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it('sends the Authorization header and maps the smallest file >= 480px wide to a StockAsset', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchJsonMock.mockResolvedValue({
      videos: [
        {
          id: 123,
          image: 'https://example.com/thumb.jpg',
          video_files: [
            {
              link: 'https://example.com/tiny.mp4',
              width: 240,
              height: 426,
              file_type: 'video/mp4',
            },
            {
              link: 'https://example.com/good.mp4',
              width: 640,
              height: 1136,
              file_type: 'video/mp4',
            },
            {
              link: 'https://example.com/huge.mp4',
              width: 1920,
              height: 3413,
              file_type: 'video/mp4',
            },
          ],
        },
      ],
    });

    const asset = await adapter.search('sunset');

    expect(asset).toEqual({
      id: 'pexels-123',
      url: 'https://example.com/good.mp4',
      thumbnail: 'https://example.com/thumb.jpg',
      sourceName: 'pexels',
      resolution: { width: 640, height: 1136 },
      type: 'video',
    });
    const [url, options] = fetchJsonMock.mock.calls[0];
    expect(url).toContain('query=sunset');
    expect((options as { headers: Record<string, string> }).headers.Authorization).toBe('test-key');
  });

  it('falls back to the largest available file when none meet the minimum width', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchJsonMock.mockResolvedValue({
      videos: [
        {
          id: 5,
          image: 'https://example.com/thumb.jpg',
          video_files: [
            {
              link: 'https://example.com/small.mp4',
              width: 200,
              height: 356,
              file_type: 'video/mp4',
            },
            {
              link: 'https://example.com/smaller.mp4',
              width: 100,
              height: 178,
              file_type: 'video/mp4',
            },
          ],
        },
      ],
    });

    const asset = await adapter.search('sunset');
    expect(asset?.url).toBe('https://example.com/small.mp4');
  });

  it('returns null when there are no results', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchJsonMock.mockResolvedValue({ videos: [] });

    expect(await adapter.search('sunset')).toBeNull();
  });

  it('lets a fetchJson error (rate limit, network failure, etc.) propagate', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchJsonMock.mockRejectedValue(new Error('rate limited'));

    await expect(adapter.search('sunset')).rejects.toThrow('rate limited');
  });
});
