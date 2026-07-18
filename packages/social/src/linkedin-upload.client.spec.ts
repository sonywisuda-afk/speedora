import { Readable } from 'node:stream';
import { uploadLinkedInVideo } from './linkedin-upload.client';

function fakeHeaders(map: Record<string, string>): { get: (name: string) => string | null } {
  return { get: (name: string) => map[name.toLowerCase()] ?? map[name] ?? null };
}

describe('uploadLinkedInVideo', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('initializes, PUTs every part in order collecting ETags, finalizes, then creates the post', async () => {
    const fetchMock = jest
      .fn()
      // 1. initializeUpload - two parts
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: {
            video: 'urn:li:video:abc',
            uploadInstructions: [
              { uploadUrl: 'https://rupload.example.com/part-0', firstByte: 0, lastByte: 4 },
              { uploadUrl: 'https://rupload.example.com/part-1', firstByte: 5, lastByte: 9 },
            ],
          },
        }),
      })
      // 2. PUT part 0
      .mockResolvedValueOnce({ ok: true, headers: fakeHeaders({ etag: 'etag-0' }) })
      // 3. PUT part 1
      .mockResolvedValueOnce({ ok: true, headers: fakeHeaders({ etag: 'etag-1' }) })
      // 4. finalizeUpload
      .mockResolvedValueOnce({ ok: true })
      // 5. create post
      .mockResolvedValueOnce({ ok: true, headers: fakeHeaders({ 'x-restli-id': 'urn:li:share:1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const videoStream = Readable.from([Buffer.from('0123456789')]); // 10 bytes -> 2x 5-byte parts

    const result = await uploadLinkedInVideo({
      accessToken: 'access-1',
      personUrn: 'urn:li:person:abc123',
      videoStream,
      title: 'My clip',
      commentary: 'Wait for it\n\n#viral #fyp',
    });

    // initializeUpload
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.linkedin.com/rest/videos?action=initializeUpload',
      expect.objectContaining({ method: 'POST' }),
    );
    const initBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(initBody.initializeUploadRequest).toEqual({
      owner: 'urn:li:person:abc123',
      fileSizeBytes: 10,
      uploadCaptions: false,
      uploadThumbnail: false,
    });

    // Part uploads, in order, sliced to their byte range
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://rupload.example.com/part-0',
      expect.objectContaining({ method: 'PUT', body: Buffer.from('01234') }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://rupload.example.com/part-1',
      expect.objectContaining({ method: 'PUT', body: Buffer.from('56789') }),
    );

    // finalizeUpload with ETags in upload-instruction order
    const finalizeBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    expect(finalizeBody.finalizeUploadRequest).toEqual({
      video: 'urn:li:video:abc',
      uploadToken: '',
      uploadedPartIds: ['etag-0', 'etag-1'],
    });

    // Post creation referencing the video URN
    const postBody = JSON.parse(fetchMock.mock.calls[4][1].body as string);
    expect(postBody).toMatchObject({
      author: 'urn:li:person:abc123',
      commentary: 'Wait for it\n\n#viral #fyp',
      visibility: 'PUBLIC',
      content: { media: { title: 'My clip', id: 'urn:li:video:abc' } },
      lifecycleState: 'PUBLISHED',
    });

    expect(result).toEqual({ postUrn: 'urn:li:share:1' });
  });

  it('throws when initializeUpload fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'fileSizeBytes exceeds the maximum allowed' }),
    }) as unknown as typeof fetch;

    await expect(
      uploadLinkedInVideo({
        accessToken: 'access-1',
        personUrn: 'urn:li:person:abc123',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        commentary: 'text',
      }),
    ).rejects.toThrow(/fileSizeBytes exceeds the maximum allowed/);
  });

  it('throws when a part PUT fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: {
            video: 'urn:li:video:abc',
            uploadInstructions: [{ uploadUrl: 'https://rupload.example.com/part-0', firstByte: 0, lastByte: 0 }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: fakeHeaders({}),
        text: async () => 'expired upload URL',
      }) as unknown as typeof fetch;

    await expect(
      uploadLinkedInVideo({
        accessToken: 'access-1',
        personUrn: 'urn:li:person:abc123',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        commentary: 'text',
      }),
    ).rejects.toThrow(/video part upload failed/);
  });

  it('throws when finalizeUpload fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: {
            video: 'urn:li:video:abc',
            uploadInstructions: [{ uploadUrl: 'https://rupload.example.com/part-0', firstByte: 0, lastByte: 0 }],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, headers: fakeHeaders({ etag: 'etag-0' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Unknown error' }),
      }) as unknown as typeof fetch;

    await expect(
      uploadLinkedInVideo({
        accessToken: 'access-1',
        personUrn: 'urn:li:person:abc123',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        commentary: 'text',
      }),
    ).rejects.toThrow(/finalizeUpload failed/);
  });

  it('throws when post creation fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: {
            video: 'urn:li:video:abc',
            uploadInstructions: [{ uploadUrl: 'https://rupload.example.com/part-0', firstByte: 0, lastByte: 0 }],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, headers: fakeHeaders({ etag: 'etag-0' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: fakeHeaders({}),
        json: async () => ({ message: 'ACCESS_DENIED' }),
      }) as unknown as typeof fetch;

    await expect(
      uploadLinkedInVideo({
        accessToken: 'access-1',
        personUrn: 'urn:li:person:abc123',
        videoStream: Readable.from([Buffer.from('x')]),
        title: 'title',
        commentary: 'text',
      }),
    ).rejects.toThrow(/posts create failed/);
  });
});
