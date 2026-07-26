import { Readable } from 'node:stream';
import { uploadXVideo } from './x-upload.client';

describe('uploadXVideo', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('runs INIT -> single APPEND -> FINALIZE (with polling) -> creates the tweet', async () => {
    const fetchMock = jest
      .fn()
      // 1. INIT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'media-1' } }) })
      // 2. APPEND (one chunk - video is small)
      .mockResolvedValueOnce({ ok: true })
      // 3. FINALIZE - has processing_info, needs polling
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { processing_info: { state: 'in_progress' } } }),
      })
      // 4. STATUS - succeeded
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { processing_info: { state: 'succeeded' } } }),
      })
      // 5. create tweet
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'tweet-1' } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const videoStream = Readable.from([Buffer.from('fake video bytes')]);

    const result = await uploadXVideo({
      accessToken: 'access-1',
      videoStream,
      text: 'Wait for it\n\n#viral #fyp',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.x.com/2/media/upload',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer access-1' },
      }),
    );
    const initForm = fetchMock.mock.calls[0][1].body as FormData;
    expect(initForm.get('command')).toBe('INIT');
    expect(initForm.get('media_type')).toBe('video/mp4');
    expect(initForm.get('total_bytes')).toBe('16');
    expect(initForm.get('media_category')).toBe('tweet_video');

    const appendForm = fetchMock.mock.calls[1][1].body as FormData;
    expect(appendForm.get('command')).toBe('APPEND');
    expect(appendForm.get('media_id')).toBe('media-1');
    expect(appendForm.get('segment_index')).toBe('0');

    const finalizeForm = fetchMock.mock.calls[2][1].body as FormData;
    expect(finalizeForm.get('command')).toBe('FINALIZE');
    expect(finalizeForm.get('media_id')).toBe('media-1');

    const statusUrl = new URL(String(fetchMock.mock.calls[3][0]));
    expect(statusUrl.pathname).toBe('/2/media/upload');
    expect(statusUrl.searchParams.get('command')).toBe('STATUS');
    expect(statusUrl.searchParams.get('media_id')).toBe('media-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://api.x.com/2/tweets',
      expect.objectContaining({ method: 'POST' }),
    );
    const tweetBody = JSON.parse(fetchMock.mock.calls[4][1].body as string);
    expect(tweetBody).toEqual({
      text: 'Wait for it\n\n#viral #fyp',
      media: { media_ids: ['media-1'] },
    });

    expect(result).toEqual({ tweetId: 'tweet-1' });
  });

  it('splits large videos into multiple APPEND chunks in order', async () => {
    const bigVideo = Buffer.alloc(9 * 1024 * 1024, 'x'); // 9MB -> 3 chunks of <=4MB
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'media-1' } }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) }) // FINALIZE, no processing_info
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'tweet-1' } }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadXVideo({
      accessToken: 'access-1',
      videoStream: Readable.from([bigVideo]),
      text: 'caption',
    });

    const appendCalls = [1, 2, 3].map((i) => fetchMock.mock.calls[i][1].body as FormData);
    expect(appendCalls.map((f) => f.get('segment_index'))).toEqual(['0', '1', '2']);
    // Total appended fetch calls (INIT + 3 APPEND + FINALIZE + tweet create), no STATUS poll needed.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('truncates the caption to 280 characters', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'media-1' } }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'tweet-1' } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const longText = 'a'.repeat(300);

    await uploadXVideo({
      accessToken: 'access-1',
      videoStream: Readable.from([Buffer.from('x')]),
      text: longText,
    });

    const tweetBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    expect(tweetBody.text).toHaveLength(280);
  });

  it('throws when INIT fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ errors: [{ title: 'Forbidden', detail: 'quota exceeded' }] }),
    }) as unknown as typeof fetch;

    await expect(
      uploadXVideo({
        accessToken: 'access-1',
        videoStream: Readable.from([Buffer.from('x')]),
        text: 'caption',
      }),
    ).rejects.toThrow(/quota exceeded/);
  });

  it('throws when an APPEND fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'media-1' } }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'server error',
      }) as unknown as typeof fetch;

    await expect(
      uploadXVideo({
        accessToken: 'access-1',
        videoStream: Readable.from([Buffer.from('x')]),
        text: 'caption',
      }),
    ).rejects.toThrow(/APPEND failed/);
  });

  it('throws when the media reports failed status after FINALIZE', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'media-1' } }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { processing_info: { state: 'in_progress' } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { processing_info: { state: 'failed' } } }),
      }) as unknown as typeof fetch;

    await expect(
      uploadXVideo({
        accessToken: 'access-1',
        videoStream: Readable.from([Buffer.from('x')]),
        text: 'caption',
      }),
    ).rejects.toThrow(/did not finish processing \(status: failed\)/);
  });

  it('throws when tweet creation fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'media-1' } }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: async () => ({
          errors: [{ title: 'Payment Required', detail: 'insufficient credits' }],
        }),
      }) as unknown as typeof fetch;

    await expect(
      uploadXVideo({
        accessToken: 'access-1',
        videoStream: Readable.from([Buffer.from('x')]),
        text: 'caption',
      }),
    ).rejects.toThrow(/insufficient credits/);
  });
});
