import { PublishStatus, SocialPlatform } from '@viral-clip-app/database';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const resolveAccessTokenMock = jest.fn();
const uploadYouTubeVideoMock = jest.fn();
const uploadTikTokVideoMock = jest.fn();
const uploadInstagramReelMock = jest.fn();
class FakeYouTubeOAuthClient {}
class FakeTikTokOAuthClient {}
class FakeInstagramOAuthClient {}
jest.mock('@viral-clip-app/social', () => ({
  resolveAccessToken: (...args: unknown[]) => resolveAccessTokenMock(...args),
  uploadYouTubeVideo: (...args: unknown[]) => uploadYouTubeVideoMock(...args),
  uploadTikTokVideo: (...args: unknown[]) => uploadTikTokVideoMock(...args),
  uploadInstagramReel: (...args: unknown[]) => uploadInstagramReelMock(...args),
  YouTubeOAuthClient: FakeYouTubeOAuthClient,
  TikTokOAuthClient: FakeTikTokOAuthClient,
  InstagramOAuthClient: FakeInstagramOAuthClient,
}));

const getObjectStreamMock = jest.fn();
const getPresignedDownloadUrlMock = jest.fn();
jest.mock('@viral-clip-app/storage', () => ({
  getObjectStream: (...args: unknown[]) => getObjectStreamMock(...args),
  getPresignedDownloadUrl: (...args: unknown[]) => getPresignedDownloadUrlMock(...args),
}));

const publishRecordFindUniqueOrThrowMock = jest.fn();
const publishRecordUpdateMock = jest.fn();
const socialAccountUpdateMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    publishRecord: {
      findUniqueOrThrow: (...args: unknown[]) => publishRecordFindUniqueOrThrowMock(...args),
      update: (...args: unknown[]) => publishRecordUpdateMock(...args),
    },
    socialAccount: {
      update: (...args: unknown[]) => socialAccountUpdateMock(...args),
    },
  },
}));

import { createPublishClipWorker } from './publish-clip.worker';

interface PublishClipJobData {
  publishRecordId: string;
}

function getProcessor() {
  createPublishClipWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: PublishClipJobData;
    attemptsMade: number;
    opts: { attempts?: number };
  }) => Promise<unknown>;
}

const baseRecord = {
  id: 'record-1',
  clipId: 'clip-1',
  socialAccountId: 'account-1',
  clip: {
    id: 'clip-1',
    outputUrl: 'renders/clip-1.mp4',
    hookText: 'Wait for it',
    hashtags: ['viral', 'fyp'],
  },
  socialAccount: {
    id: 'account-1',
    platform: SocialPlatform.YOUTUBE,
    accessToken: 'encrypted-access',
    refreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date('2099-01-01'),
  },
};

function baseJob(overrides: Partial<{ attemptsMade: number; opts: { attempts?: number } }> = {}) {
  return {
    data: { publishRecordId: 'record-1' },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  };
}

describe('publish-clip worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publishRecordFindUniqueOrThrowMock.mockResolvedValue(baseRecord);
    publishRecordUpdateMock.mockResolvedValue({});
    socialAccountUpdateMock.mockResolvedValue({});
    resolveAccessTokenMock.mockResolvedValue({ accessToken: 'plaintext-access', refreshed: false });
    getObjectStreamMock.mockResolvedValue({ fake: 'readable' });
    uploadYouTubeVideoMock.mockResolvedValue({
      videoId: 'yt-video-1',
      url: 'https://youtu.be/yt-video-1',
    });
    uploadTikTokVideoMock.mockResolvedValue({ publishId: 'tiktok-publish-1' });
    getPresignedDownloadUrlMock.mockResolvedValue(
      'https://bucket.example.com/renders/clip-1.mp4?signed=1',
    );
    uploadInstagramReelMock.mockResolvedValue({ mediaId: 'ig-media-1' });
  });

  it('uploads the rendered clip to YouTube unlisted and marks the record PUBLISHED', async () => {
    const processor = getProcessor();

    const result = await processor(baseJob());

    expect(publishRecordFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      include: { clip: true, socialAccount: true },
    });
    expect(publishRecordUpdateMock).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: { status: PublishStatus.PUBLISHING },
    });
    expect(getObjectStreamMock).toHaveBeenCalledWith('renders/clip-1.mp4');
    expect(uploadYouTubeVideoMock).toHaveBeenCalledWith({
      accessToken: 'plaintext-access',
      title: 'Wait for it',
      description: '#viral #fyp',
      videoStream: { fake: 'readable' },
      privacyStatus: 'unlisted',
    });
    expect(publishRecordUpdateMock).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: {
        status: PublishStatus.PUBLISHED,
        platformPostId: 'yt-video-1',
        publishedAt: expect.any(Date),
      },
    });
    expect(result).toEqual({ publishRecordId: 'record-1', platformPostId: 'yt-video-1' });
  });

  it('falls back to a generic title when the clip has no hookText', async () => {
    publishRecordFindUniqueOrThrowMock.mockResolvedValue({
      ...baseRecord,
      clip: { ...baseRecord.clip, hookText: null },
    });

    const processor = getProcessor();
    await processor(baseJob());

    expect(uploadYouTubeVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Clip clip-1' }),
    );
  });

  it('persists refreshed tokens on the social account when resolveAccessToken refreshes', async () => {
    resolveAccessTokenMock.mockResolvedValue({
      accessToken: 'new-plaintext-access',
      refreshed: true,
      updated: {
        accessToken: 'new-encrypted-access',
        refreshToken: 'new-encrypted-refresh',
        tokenExpiresAt: new Date('2099-02-01'),
      },
    });

    const processor = getProcessor();
    await processor(baseJob());

    expect(socialAccountUpdateMock).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: {
        accessToken: 'new-encrypted-access',
        refreshToken: 'new-encrypted-refresh',
        tokenExpiresAt: new Date('2099-02-01'),
      },
    });
    expect(uploadYouTubeVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new-plaintext-access' }),
    );
  });

  it('throws without uploading when the clip has not finished rendering', async () => {
    publishRecordFindUniqueOrThrowMock.mockResolvedValue({
      ...baseRecord,
      clip: { ...baseRecord.clip, outputUrl: null },
    });

    const processor = getProcessor();

    await expect(processor(baseJob({ opts: { attempts: 1 } }))).rejects.toThrow(
      'Clip clip-1 has no rendered output to publish',
    );
    expect(uploadYouTubeVideoMock).not.toHaveBeenCalled();
  });

  it('reports the failure to Sentry tagged with publishRecordId/clipId/socialAccountId only', async () => {
    const error = new Error('YouTube quota exceeded');
    uploadYouTubeVideoMock.mockRejectedValue(error);

    const processor = getProcessor();
    await expect(processor(baseJob({ opts: { attempts: 1 } }))).rejects.toThrow(
      'YouTube quota exceeded',
    );

    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      tags: { publishRecordId: 'record-1', clipId: 'clip-1', socialAccountId: 'account-1' },
    });
  });

  it('marks the record FAILED only on the final BullMQ attempt, not on a retryable failure', async () => {
    uploadYouTubeVideoMock.mockRejectedValue(new Error('transient 503'));

    const processor = getProcessor();
    // attemptsMade=0 with attempts=3 means this is attempt 1 of 3 - not final.
    await expect(processor(baseJob({ attemptsMade: 0, opts: { attempts: 3 } }))).rejects.toThrow(
      'transient 503',
    );

    expect(publishRecordUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PublishStatus.FAILED }) }),
    );
  });

  it('marks the record FAILED with the error message on the final attempt', async () => {
    uploadYouTubeVideoMock.mockRejectedValue(new Error('permanently broken'));

    const processor = getProcessor();
    // attemptsMade=2 with attempts=3 means this is attempt 3 of 3 - final.
    await expect(processor(baseJob({ attemptsMade: 2, opts: { attempts: 3 } }))).rejects.toThrow(
      'permanently broken',
    );

    expect(publishRecordUpdateMock).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: { status: PublishStatus.FAILED, errorMessage: 'permanently broken' },
    });
  });

  describe('TikTok accounts', () => {
    const tiktokRecord = {
      ...baseRecord,
      socialAccount: { ...baseRecord.socialAccount, platform: SocialPlatform.TIKTOK },
    };

    it('uploads to the TikTok inbox (not YouTube) and marks the record PUBLISHED with the publish_id', async () => {
      publishRecordFindUniqueOrThrowMock.mockResolvedValue(tiktokRecord);

      const processor = getProcessor();
      const result = await processor(baseJob());

      expect(uploadTikTokVideoMock).toHaveBeenCalledWith({
        accessToken: 'plaintext-access',
        videoStream: { fake: 'readable' },
      });
      expect(uploadYouTubeVideoMock).not.toHaveBeenCalled();
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-1' },
        data: {
          status: PublishStatus.PUBLISHED,
          platformPostId: 'tiktok-publish-1',
          publishedAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ publishRecordId: 'record-1', platformPostId: 'tiktok-publish-1' });
    });

    it('resolves the access token via the TikTok client, not YouTube', async () => {
      publishRecordFindUniqueOrThrowMock.mockResolvedValue(tiktokRecord);

      const processor = getProcessor();
      await processor(baseJob());

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        tiktokRecord.socialAccount,
        expect.any(FakeTikTokOAuthClient),
      );
    });
  });

  describe('Instagram accounts', () => {
    const instagramRecord = {
      ...baseRecord,
      socialAccount: {
        ...baseRecord.socialAccount,
        platform: SocialPlatform.INSTAGRAM,
        platformAccountId: 'ig-user-1',
      },
    };

    it('generates a presigned URL, publishes as a Reel (not YouTube/TikTok), and marks PUBLISHED with the media id', async () => {
      publishRecordFindUniqueOrThrowMock.mockResolvedValue(instagramRecord);

      const processor = getProcessor();
      const result = await processor(baseJob());

      expect(getPresignedDownloadUrlMock).toHaveBeenCalledWith('renders/clip-1.mp4', 15 * 60);
      expect(uploadInstagramReelMock).toHaveBeenCalledWith({
        accessToken: 'plaintext-access',
        igUserId: 'ig-user-1',
        videoUrl: 'https://bucket.example.com/renders/clip-1.mp4?signed=1',
        caption: 'Wait for it\n\n#viral #fyp',
      });
      expect(getObjectStreamMock).not.toHaveBeenCalled();
      expect(uploadYouTubeVideoMock).not.toHaveBeenCalled();
      expect(uploadTikTokVideoMock).not.toHaveBeenCalled();
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-1' },
        data: {
          status: PublishStatus.PUBLISHED,
          platformPostId: 'ig-media-1',
          publishedAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ publishRecordId: 'record-1', platformPostId: 'ig-media-1' });
    });

    it('builds the caption from just hookText when there are no hashtags', async () => {
      publishRecordFindUniqueOrThrowMock.mockResolvedValue({
        ...instagramRecord,
        clip: { ...instagramRecord.clip, hashtags: [] },
      });

      const processor = getProcessor();
      await processor(baseJob());

      expect(uploadInstagramReelMock).toHaveBeenCalledWith(
        expect.objectContaining({ caption: 'Wait for it' }),
      );
    });

    it('resolves the access token via the Instagram client, not YouTube/TikTok', async () => {
      publishRecordFindUniqueOrThrowMock.mockResolvedValue(instagramRecord);

      const processor = getProcessor();
      await processor(baseJob());

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        instagramRecord.socialAccount,
        expect.any(FakeInstagramOAuthClient),
      );
    });
  });
});
