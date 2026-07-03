import { uploadInstagramReel } from './instagram-upload.client';

describe('uploadInstagramReel', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('creates a container, polls until FINISHED, then publishes it', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      // 1. create container
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container-1' }) })
      // 2. first status check - still processing
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'IN_PROGRESS' }) })
      // 3. second status check - finished
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      // 4. publish
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = uploadInstagramReel({
      accessToken: 'page-token',
      igUserId: 'ig-user-1',
      videoUrl: 'https://bucket.example.com/renders/clip.mp4?signed=1',
      caption: 'My hook\n\n#viral #fyp',
    });

    // Let the create-container call and first status check settle (real
    // microtasks, not timers), then advance the fake clock past the 5s
    // poll interval so the second status check fires without a real wait.
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(5_000);

    const result = await resultPromise;

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v21.0/ig-user-1/media',
      expect.objectContaining({ method: 'POST' }),
    );
    const createBody = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(createBody.get('media_type')).toBe('REELS');
    expect(createBody.get('video_url')).toBe(
      'https://bucket.example.com/renders/clip.mp4?signed=1',
    );
    expect(createBody.get('caption')).toBe('My hook\n\n#viral #fyp');

    const secondStatusUrl = new URL(String(fetchMock.mock.calls[2][0]));
    expect(secondStatusUrl.pathname).toBe('/v21.0/container-1');
    expect(secondStatusUrl.searchParams.get('fields')).toBe('status_code');

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://graph.facebook.com/v21.0/ig-user-1/media_publish',
      expect.objectContaining({ method: 'POST' }),
    );
    const publishBody = fetchMock.mock.calls[3][1].body as URLSearchParams;
    expect(publishBody.get('creation_id')).toBe('container-1');

    expect(result).toEqual({ mediaId: 'media-1' });
  });

  it('throws when the container create fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Media type is not supported' } }),
    }) as unknown as typeof fetch;

    await expect(
      uploadInstagramReel({
        accessToken: 'page-token',
        igUserId: 'ig-user-1',
        videoUrl: 'https://bucket.example.com/renders/clip.mp4',
        caption: 'caption',
      }),
    ).rejects.toThrow(/Media type is not supported/);
  });

  it('throws when the container reports ERROR', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status_code: 'ERROR' }),
      }) as unknown as typeof fetch;

    await expect(
      uploadInstagramReel({
        accessToken: 'page-token',
        igUserId: 'ig-user-1',
        videoUrl: 'https://bucket.example.com/renders/clip.mp4',
        caption: 'caption',
      }),
    ).rejects.toThrow(/did not finish processing \(status: ERROR\)/);
  });

  it('throws when media_publish fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Unknown error' } }),
      }) as unknown as typeof fetch;

    await expect(
      uploadInstagramReel({
        accessToken: 'page-token',
        igUserId: 'ig-user-1',
        videoUrl: 'https://bucket.example.com/renders/clip.mp4',
        caption: 'caption',
      }),
    ).rejects.toThrow(/media_publish failed/);
  });
});
