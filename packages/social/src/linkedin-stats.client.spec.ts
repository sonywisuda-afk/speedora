import { fetchLinkedInPostStats } from './linkedin-stats.client';

describe('fetchLinkedInPostStats', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches and maps totalLikes/aggregatedTotalComments to their stat fields', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        likesSummary: { totalLikes: 56 },
        commentsSummary: { aggregatedTotalComments: 7 },
        target: 'urn:li:share:1',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const stats = await fetchLinkedInPostStats('access-1', 'urn:li:share:1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A1',
      { headers: expect.objectContaining({ Authorization: 'Bearer access-1' }) },
    );
    expect(stats).toEqual({
      viewCount: null,
      likeCount: 56,
      commentCount: 7,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('returns all nulls for a post with no likes/comments (empty JSON response)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const stats = await fetchLinkedInPostStats('access-1', 'urn:li:share:1');

    expect(stats).toEqual({
      viewCount: null,
      likeCount: null,
      commentCount: null,
      shareCount: null,
      watchTimeSeconds: null,
    });
  });

  it('throws with the LinkedIn error message when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Post not found' }),
    }) as unknown as typeof fetch;

    await expect(fetchLinkedInPostStats('access-1', 'urn:li:share:1')).rejects.toThrow(
      /Post not found/,
    );
  });
});
