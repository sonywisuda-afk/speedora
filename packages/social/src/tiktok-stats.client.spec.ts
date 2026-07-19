import {
  fetchTikTokFollowerCount,
  fetchTikTokPublishStatus,
  fetchTikTokVideoStats,
} from './tiktok-stats.client';

describe('fetchTikTokFollowerCount', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches follower_count via user/info with the fields param', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { follower_count: 111 } } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await fetchTikTokFollowerCount('access-token');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://open.tiktokapis.com/v2/user/info/');
    expect(url.searchParams.get('fields')).toBe('follower_count');
    expect(count).toBe(111);
  });

  it('throws when the account has not reconnected to grant user.info.stats yet', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'scope_not_authorized', message: 'missing scope' } }),
    }) as unknown as typeof fetch;

    await expect(fetchTikTokFollowerCount('access-token')).rejects.toThrow(
      /TikTok user\/info \(stats\) failed/,
    );
  });
});

describe('fetchTikTokPublishStatus', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the status with no videoId while still pending in the inbox', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'SEND_TO_USER_INBOX' } }),
    }) as unknown as typeof fetch;

    const result = await fetchTikTokPublishStatus('access-token', 'publish-1');

    expect(result).toEqual({ status: 'SEND_TO_USER_INBOX', videoId: null });
  });

  it('returns the resulting videoId once the user has finished posting', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [123456789] },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchTikTokPublishStatus('access-token', 'publish-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      publish_id: 'publish-1',
    });
    expect(result).toEqual({ status: 'PUBLISH_COMPLETE', videoId: '123456789' });
  });

  it('throws when TikTok reports an error code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: 'invalid_publish_id', message: 'not found' } }),
    }) as unknown as typeof fetch;

    await expect(fetchTikTokPublishStatus('access-token', 'bad-id')).rejects.toThrow(/not found/);
  });
});

describe('fetchTikTokVideoStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches and maps view/like/comment/share counts for the given video id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          videos: [
            { id: '123456789', view_count: 1234, like_count: 56, comment_count: 7, share_count: 3 },
          ],
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const stats = await fetchTikTokVideoStats('access-token', '123456789');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://open.tiktokapis.com/v2/video/query/');
    expect(url.searchParams.get('fields')).toBe(
      'id,view_count,like_count,comment_count,share_count',
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      filters: { video_ids: ['123456789'] },
    });
    expect(stats).toEqual({ viewCount: 1234, likeCount: 56, commentCount: 7, shareCount: 3 });
  });

  it('returns nulls when the video is missing from the response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { videos: [] } }),
    }) as unknown as typeof fetch;

    const stats = await fetchTikTokVideoStats('access-token', '123456789');

    expect(stats).toEqual({
      viewCount: null,
      likeCount: null,
      commentCount: null,
      shareCount: null,
    });
  });

  it('throws when TikTok reports an error code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: 'access_token_invalid', message: 'bad token' } }),
    }) as unknown as typeof fetch;

    await expect(fetchTikTokVideoStats('bad-token', '123456789')).rejects.toThrow(/bad token/);
  });
});
