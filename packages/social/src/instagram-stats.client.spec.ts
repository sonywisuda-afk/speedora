import { fetchInstagramFollowerCount, fetchInstagramMediaStats } from './instagram-stats.client';

describe('fetchInstagramFollowerCount', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches followers_count on the IG Business account node', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ followers_count: 9876 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await fetchInstagramFollowerCount('page-token', 'ig-user-1');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v21.0/ig-user-1');
    expect(url.searchParams.get('fields')).toBe('followers_count');
    expect(count).toBe(9876);
  });

  it('throws on a Graph API error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid OAuth access token' } }),
    }) as unknown as typeof fetch;

    await expect(fetchInstagramFollowerCount('bad-token', 'ig-user-1')).rejects.toThrow(
      /Instagram followers_count fetch failed/,
    );
  });
});

describe('fetchInstagramMediaStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches and maps plays/likes/comments/shares/watch-time to their stat fields', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { name: 'plays', values: [{ value: 1234 }] },
          { name: 'likes', values: [{ value: 56 }] },
          { name: 'comments', values: [{ value: 7 }] },
          { name: 'shares', values: [{ value: 3 }] },
          { name: 'ig_reels_avg_watch_time', values: [{ value: 12.5 }] },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const stats = await fetchInstagramMediaStats('page-token', 'media-1');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v21.0/media-1/insights');
    expect(url.searchParams.get('metric')).toBe(
      'plays,likes,comments,shares,ig_reels_avg_watch_time',
    );
    expect(url.searchParams.get('access_token')).toBe('page-token');
    expect(stats).toEqual({
      viewCount: 1234,
      likeCount: 56,
      commentCount: 7,
      shareCount: 3,
      watchTimeSeconds: 12.5,
    });
  });

  it('returns null for any metric missing from the response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ name: 'plays', values: [{ value: 10 }] }] }),
    }) as unknown as typeof fetch;

    const stats = await fetchInstagramMediaStats('page-token', 'media-1');

    expect(stats).toEqual({
      viewCount: 10,
      likeCount: null,
      commentCount: null,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('throws with the Graph API error message when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid metric plays' } }),
    }) as unknown as typeof fetch;

    await expect(fetchInstagramMediaStats('page-token', 'media-1')).rejects.toThrow(
      /Invalid metric plays/,
    );
  });
});
