import { fetchPinterestFollowerCount, fetchPinterestPinStats } from './pinterest-stats.client';

describe('fetchPinterestFollowerCount', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches follower_count from /user_account, no board/pin id needed', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ follower_count: 321 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await fetchPinterestFollowerCount('access-token');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.pinterest.com/v5/user_account');
    expect(fetchMock.mock.calls[0][1]).toEqual({
      headers: { Authorization: 'Bearer access-token' },
    });
    expect(count).toBe(321);
  });

  it('throws when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'invalid token' }),
    }) as unknown as typeof fetch;

    await expect(fetchPinterestFollowerCount('bad-token')).rejects.toThrow(
      /Pinterest user_account fetch failed/,
    );
  });
});

describe('fetchPinterestPinStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches a 90-day TOTAL-granularity window and maps IMPRESSION/SAVE to view/like counts', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ all: { summary_metrics: { IMPRESSION: 1234, SAVE: 56 } } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const stats = await fetchPinterestPinStats('access-1', 'pin-1');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v5/pins/pin-1/analytics');
    expect(url.searchParams.get('metric_types')).toBe('IMPRESSION,SAVE');
    expect(url.searchParams.get('granularity')).toBe('TOTAL');
    expect(url.searchParams.get('start_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.get('end_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer access-1' } });

    expect(stats).toEqual({
      viewCount: 1234,
      likeCount: 56,
      commentCount: null,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('returns nulls when summary_metrics is absent', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ all: {} }),
    }) as unknown as typeof fetch;

    const stats = await fetchPinterestPinStats('access-1', 'pin-1');

    expect(stats).toEqual({
      viewCount: null,
      likeCount: null,
      commentCount: null,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('throws with the Pinterest error message when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Pin not found' }),
    }) as unknown as typeof fetch;

    await expect(fetchPinterestPinStats('access-1', 'pin-1')).rejects.toThrow(/Pin not found/);
  });
});
