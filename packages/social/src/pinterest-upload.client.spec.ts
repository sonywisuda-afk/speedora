import { Readable } from 'node:stream';
import { uploadPinterestVideo } from './pinterest-upload.client';

describe('uploadPinterestVideo', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('registers media, uploads via the presigned form, polls until succeeded, then creates the Pin', async () => {
    const fetchMock = jest
      .fn()
      // 1. register media
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          media_id: 'media-1',
          upload_url: 'https://s3.example.com/upload',
          upload_parameters: { key: 'uploads/media-1', policy: 'abc' },
        }),
      })
      // 2. upload to presigned URL
      .mockResolvedValueOnce({ ok: true })
      // 3. poll status - succeeded immediately
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'succeeded' }) })
      // 4. create Pin
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'pin-1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const videoStream = Readable.from([Buffer.from('fake video bytes')]);

    const result = await uploadPinterestVideo({
      accessToken: 'access-1',
      boardId: 'board-1',
      videoStream,
      title: 'My clip',
      description: 'Wait for it #viral #fyp',
      coverImageUrl: 'https://bucket.example.com/thumb.jpg?signed=1',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.pinterest.com/v5/media',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ media_type: 'video' });

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(uploadUrl).toBe('https://s3.example.com/upload');
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.body).toBeInstanceOf(FormData);

    const statusUrl = fetchMock.mock.calls[2][0];
    expect(statusUrl).toBe('https://api.pinterest.com/v5/media/media-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://api.pinterest.com/v5/pins',
      expect.objectContaining({ method: 'POST' }),
    );
    const pinBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    expect(pinBody).toEqual({
      title: 'My clip',
      description: 'Wait for it #viral #fyp',
      board_id: 'board-1',
      media_source: {
        source_type: 'video_id',
        cover_image_url: 'https://bucket.example.com/thumb.jpg?signed=1',
        media_id: 'media-1',
      },
    });

    expect(result).toEqual({ pinId: 'pin-1' });
  });

  it('throws when media registration fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid media_type' }),
    }) as unknown as typeof fetch;

    await expect(
      uploadPinterestVideo({
        accessToken: 'access-1',
        boardId: 'board-1',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        description: 'desc',
        coverImageUrl: 'https://bucket.example.com/thumb.jpg',
      }),
    ).rejects.toThrow(/media register failed/);
  });

  it('throws when the presigned upload fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          media_id: 'media-1',
          upload_url: 'https://s3.example.com/upload',
          upload_parameters: {},
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'expired' }) as unknown as typeof fetch;

    await expect(
      uploadPinterestVideo({
        accessToken: 'access-1',
        boardId: 'board-1',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        description: 'desc',
        coverImageUrl: 'https://bucket.example.com/thumb.jpg',
      }),
    ).rejects.toThrow(/media upload failed/);
  });

  it('throws when the media reports failed status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          media_id: 'media-1',
          upload_url: 'https://s3.example.com/upload',
          upload_parameters: {},
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'failed' }) }) as unknown as typeof fetch;

    await expect(
      uploadPinterestVideo({
        accessToken: 'access-1',
        boardId: 'board-1',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        description: 'desc',
        coverImageUrl: 'https://bucket.example.com/thumb.jpg',
      }),
    ).rejects.toThrow(/did not finish processing \(status: failed\)/);
  });

  it('throws when Pin creation fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          media_id: 'media-1',
          upload_url: 'https://s3.example.com/upload',
          upload_parameters: {},
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'succeeded' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'cover_image_url is required' }),
      }) as unknown as typeof fetch;

    await expect(
      uploadPinterestVideo({
        accessToken: 'access-1',
        boardId: 'board-1',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        description: 'desc',
        coverImageUrl: '',
      }),
    ).rejects.toThrow(/cover_image_url is required/);
  });
});
