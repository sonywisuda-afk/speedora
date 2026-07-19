import { fetchYouTubeFollowerCount, fetchYouTubeVideoStats } from './youtube-stats.client';

describe('fetchYouTubeFollowerCount', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches channels.list?part=statistics&mine=true and parses subscriberCount', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ statistics: { subscriberCount: '4321' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await fetchYouTubeFollowerCount('access-token');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/channels');
    expect(url.searchParams.get('part')).toBe('statistics');
    expect(url.searchParams.get('mine')).toBe('true');
    expect(count).toBe(4321);
  });

  it('throws when no channel/subscriberCount is found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    }) as unknown as typeof fetch;

    await expect(fetchYouTubeFollowerCount('access-token')).rejects.toThrow(
      /No YouTube channel\/subscriberCount found/,
    );
  });
});

describe('fetchYouTubeVideoStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches and parses statistics (returned as strings) into numbers', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ statistics: { viewCount: '1234', likeCount: '56', commentCount: '7' } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const stats = await fetchYouTubeVideoStats('access-token', 'video-1');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(url.searchParams.get('part')).toBe('statistics');
    expect(url.searchParams.get('id')).toBe('video-1');
    expect(fetchMock.mock.calls[0][1]).toEqual({
      headers: { Authorization: 'Bearer access-token' },
    });
    expect(stats).toEqual({ viewCount: 1234, likeCount: 56, commentCount: 7 });
  });

  it('returns null likeCount/commentCount when the creator disabled them', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ statistics: { viewCount: '10' } }] }),
    }) as unknown as typeof fetch;

    const stats = await fetchYouTubeVideoStats('access-token', 'video-1');

    expect(stats).toEqual({ viewCount: 10, likeCount: null, commentCount: null });
  });

  it('throws when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid token',
    }) as unknown as typeof fetch;

    await expect(fetchYouTubeVideoStats('bad-token', 'video-1')).rejects.toThrow(
      /videos\.list \(statistics\) failed/,
    );
  });

  it('throws when no video is found for the given id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    }) as unknown as typeof fetch;

    await expect(fetchYouTubeVideoStats('access-token', 'missing-video')).rejects.toThrow(
      /No YouTube video found/,
    );
  });
});
