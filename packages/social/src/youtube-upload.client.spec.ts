import { Readable } from 'node:stream';

const insertMock = jest.fn();
const setCredentialsMock = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    youtube: jest.fn().mockReturnValue({
      videos: { insert: (...args: unknown[]) => insertMock(...args) },
    }),
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: setCredentialsMock,
      })),
    },
  },
}));

import { uploadYouTubeVideo } from './youtube-upload.client';

describe('uploadYouTubeVideo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads with the given title/description and defaults to unlisted visibility', async () => {
    insertMock.mockResolvedValue({ data: { id: 'yt-video-1' } });
    const videoStream = Readable.from([Buffer.from('fake video bytes')]);

    const result = await uploadYouTubeVideo({
      accessToken: 'access-token',
      title: 'My hook',
      description: '#viral #fyp',
      videoStream,
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: { title: 'My hook', description: '#viral #fyp' },
          status: { privacyStatus: 'unlisted' },
        },
        media: { body: videoStream },
      }),
    );
    expect(result).toEqual({ videoId: 'yt-video-1', url: 'https://youtu.be/yt-video-1' });
    expect(setCredentialsMock).toHaveBeenCalledWith({ access_token: 'access-token' });
  });

  it('respects an explicit privacyStatus override', async () => {
    insertMock.mockResolvedValue({ data: { id: 'yt-video-1' } });

    await uploadYouTubeVideo({
      accessToken: 'access-token',
      title: 't',
      description: 'd',
      videoStream: Readable.from([Buffer.from('x')]),
      privacyStatus: 'public',
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ status: { privacyStatus: 'public' } }),
      }),
    );
  });

  it('throws when YouTube does not return a video id', async () => {
    insertMock.mockResolvedValue({ data: {} });

    await expect(
      uploadYouTubeVideo({
        accessToken: 'access-token',
        title: 't',
        description: 'd',
        videoStream: Readable.from([Buffer.from('x')]),
      }),
    ).rejects.toThrow(/did not return a video id/);
  });
});
