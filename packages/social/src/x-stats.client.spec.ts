import { fetchXFollowerCount, fetchXTweetStats } from './x-stats.client';

describe('fetchXFollowerCount', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches public_metrics.followers_count from /2/users/me', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { public_metrics: { followers_count: 654 } } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await fetchXFollowerCount('access-token');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/2/users/me');
    expect(url.searchParams.get('user.fields')).toBe('public_metrics');
    expect(count).toBe(654);
  });

  it('throws when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: [{ title: 'Unauthorized', detail: 'bad token' }] }),
    }) as unknown as typeof fetch;

    await expect(fetchXFollowerCount('bad-token')).rejects.toThrow(/X users\/me fetch failed/);
  });
});

describe('fetchXTweetStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches public_metrics and maps them to their stat fields', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          public_metrics: {
            impression_count: 1234,
            like_count: 56,
            reply_count: 7,
            retweet_count: 3,
          },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const stats = await fetchXTweetStats('access-1', 'tweet-1');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/2/tweets/tweet-1');
    expect(url.searchParams.get('tweet.fields')).toBe('public_metrics');
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer access-1' } });

    expect(stats).toEqual({
      viewCount: 1234,
      likeCount: 56,
      commentCount: 7,
      shareCount: 3,
      watchTimeSeconds: null,
    });
  });

  it('returns nulls when public_metrics is absent', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    }) as unknown as typeof fetch;

    const stats = await fetchXTweetStats('access-1', 'tweet-1');

    expect(stats).toEqual({
      viewCount: null,
      likeCount: null,
      commentCount: null,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('throws with the X error message when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ errors: [{ title: 'Not Found', detail: 'Tweet not found' }] }),
    }) as unknown as typeof fetch;

    await expect(fetchXTweetStats('access-1', 'tweet-1')).rejects.toThrow(/Tweet not found/);
  });
});
