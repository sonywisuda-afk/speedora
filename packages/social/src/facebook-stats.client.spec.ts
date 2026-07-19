import { fetchFacebookFollowerCount, fetchFacebookVideoStats } from './facebook-stats.client';

describe('fetchFacebookFollowerCount', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches followers_count on the Page node', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ followers_count: 5432 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await fetchFacebookFollowerCount('page-token', 'page-1');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v21.0/page-1');
    expect(url.searchParams.get('fields')).toBe('followers_count');
    expect(count).toBe(5432);
  });

  it('throws on a Graph API error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid OAuth access token' } }),
    }) as unknown as typeof fetch;

    await expect(fetchFacebookFollowerCount('bad-token', 'page-1')).rejects.toThrow(
      /Facebook followers_count fetch failed/,
    );
  });
});

describe('fetchFacebookVideoStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches Reels plays from video_insights and likes/comments from the video edges', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ name: 'blue_reels_play_count', values: [{ value: 1234 }] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          likes: { summary: { total_count: 56 } },
          comments: { summary: { total_count: 7 } },
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const stats = await fetchFacebookVideoStats('page-token', 'video-1');

    const insightsUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(insightsUrl.pathname).toBe('/v21.0/video-1/video_insights');
    expect(insightsUrl.searchParams.get('metric')).toBe('blue_reels_play_count');

    const engagementUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(engagementUrl.pathname).toBe('/v21.0/video-1');
    expect(engagementUrl.searchParams.get('fields')).toBe('likes.summary(true),comments.summary(true)');

    expect(stats).toEqual({
      viewCount: 1234,
      likeCount: 56,
      commentCount: 7,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('returns null view count when the insights metric is missing from the response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ likes: { summary: { total_count: 0 } } }),
      }) as unknown as typeof fetch;

    const stats = await fetchFacebookVideoStats('page-token', 'video-1');

    expect(stats).toEqual({
      viewCount: null,
      likeCount: 0,
      commentCount: null,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('throws with the Graph API error message when the insights request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid metric blue_reels_play_count' } }),
    }) as unknown as typeof fetch;

    await expect(fetchFacebookVideoStats('page-token', 'video-1')).rejects.toThrow(
      /Invalid metric blue_reels_play_count/,
    );
  });

  it('throws with the Graph API error message when the engagement request fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ name: 'blue_reels_play_count', values: [{ value: 10 }] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Unsupported get request' } }),
      }) as unknown as typeof fetch;

    await expect(fetchFacebookVideoStats('page-token', 'video-1')).rejects.toThrow(
      /Unsupported get request/,
    );
  });
});
