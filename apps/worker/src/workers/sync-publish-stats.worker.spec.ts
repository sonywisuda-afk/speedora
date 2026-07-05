import { PublishStatus, SocialPlatform } from '@speedora/database';
import { QueueName } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const resolveAccessTokenMock = jest.fn();
const fetchYouTubeVideoStatsMock = jest.fn();
const fetchInstagramMediaStatsMock = jest.fn();
const fetchTikTokPublishStatusMock = jest.fn();
const fetchTikTokVideoStatsMock = jest.fn();
class FakeYouTubeOAuthClient {}
class FakeInstagramOAuthClient {}
class FakeTikTokOAuthClient {}
jest.mock('@speedora/social', () => ({
  resolveAccessToken: (...args: unknown[]) => resolveAccessTokenMock(...args),
  fetchYouTubeVideoStats: (...args: unknown[]) => fetchYouTubeVideoStatsMock(...args),
  fetchInstagramMediaStats: (...args: unknown[]) => fetchInstagramMediaStatsMock(...args),
  fetchTikTokPublishStatus: (...args: unknown[]) => fetchTikTokPublishStatusMock(...args),
  fetchTikTokVideoStats: (...args: unknown[]) => fetchTikTokVideoStatsMock(...args),
  YouTubeOAuthClient: FakeYouTubeOAuthClient,
  InstagramOAuthClient: FakeInstagramOAuthClient,
  TikTokOAuthClient: FakeTikTokOAuthClient,
}));

const publishRecordFindManyMock = jest.fn();
const publishRecordUpdateMock = jest.fn();
const socialAccountUpdateMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    publishRecord: {
      findMany: (...args: unknown[]) => publishRecordFindManyMock(...args),
      update: (...args: unknown[]) => publishRecordUpdateMock(...args),
    },
    socialAccount: {
      update: (...args: unknown[]) => socialAccountUpdateMock(...args),
    },
  },
}));

const syncPublishStatsQueueAddMock = jest.fn();
jest.mock('../queues', () => ({
  syncPublishStatsQueue: { add: (...args: unknown[]) => syncPublishStatsQueueAddMock(...args) },
}));

import {
  createSyncPublishStatsWorker,
  scheduleRepeatingTrigger,
} from './sync-publish-stats.worker';

function getProcessor() {
  createSyncPublishStatsWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: unknown) => Promise<unknown>;
}

const youtubeRecord = {
  id: 'record-1',
  socialAccountId: 'account-1',
  platformPostId: 'yt-video-1',
  socialAccount: {
    id: 'account-1',
    platform: SocialPlatform.YOUTUBE,
    accessToken: 'encrypted-access',
    refreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date('2099-01-01'),
  },
};

const instagramRecord = {
  id: 'record-2',
  socialAccountId: 'account-2',
  platformPostId: 'ig-media-1',
  socialAccount: {
    id: 'account-2',
    platform: SocialPlatform.INSTAGRAM,
    accessToken: 'encrypted-access-2',
    refreshToken: 'encrypted-refresh-2',
    tokenExpiresAt: new Date('2099-01-01'),
  },
};

const tiktokRecord = {
  id: 'record-3',
  socialAccountId: 'account-3',
  platformPostId: 'tiktok-publish-1',
  socialAccount: {
    id: 'account-3',
    platform: SocialPlatform.TIKTOK,
    accessToken: 'encrypted-access-3',
    refreshToken: 'encrypted-refresh-3',
    tokenExpiresAt: new Date('2099-01-01'),
  },
};

describe('sync-publish-stats worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publishRecordFindManyMock.mockResolvedValue([]);
    publishRecordUpdateMock.mockResolvedValue({});
    socialAccountUpdateMock.mockResolvedValue({});
    resolveAccessTokenMock.mockResolvedValue({ accessToken: 'plaintext-access', refreshed: false });
    fetchYouTubeVideoStatsMock.mockResolvedValue({
      viewCount: 100,
      likeCount: 10,
      commentCount: 2,
    });
    fetchInstagramMediaStatsMock.mockResolvedValue({
      viewCount: 200,
      likeCount: 20,
      commentCount: 4,
    });
    fetchTikTokPublishStatusMock.mockResolvedValue({
      status: 'PUBLISH_COMPLETE',
      videoId: 'tiktok-video-1',
    });
    fetchTikTokVideoStatsMock.mockResolvedValue({ viewCount: 300, likeCount: 30, commentCount: 6 });
  });

  describe('scheduleRepeatingTrigger', () => {
    it('registers the repeatable trigger every 6 hours with a fixed jobId', async () => {
      await scheduleRepeatingTrigger();

      expect(syncPublishStatsQueueAddMock).toHaveBeenCalledWith(
        QueueName.SYNC_PUBLISH_STATS,
        {},
        { repeat: { every: 6 * 60 * 60 * 1000 }, jobId: 'sync-publish-stats-poll' },
      );
    });
  });

  describe('processor', () => {
    it('queries PUBLISHED records for YOUTUBE/INSTAGRAM/TIKTOK', async () => {
      const processor = getProcessor();
      await processor({});

      expect(publishRecordFindManyMock).toHaveBeenCalledWith({
        where: {
          status: PublishStatus.PUBLISHED,
          socialAccount: {
            platform: {
              in: [SocialPlatform.YOUTUBE, SocialPlatform.INSTAGRAM, SocialPlatform.TIKTOK],
            },
          },
        },
        include: { socialAccount: true },
      });
    });

    it('fetches and persists YouTube stats via the YouTube client', async () => {
      publishRecordFindManyMock.mockResolvedValue([youtubeRecord]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        youtubeRecord.socialAccount,
        expect.any(FakeYouTubeOAuthClient),
      );
      expect(fetchYouTubeVideoStatsMock).toHaveBeenCalledWith('plaintext-access', 'yt-video-1');
      expect(fetchInstagramMediaStatsMock).not.toHaveBeenCalled();
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-1' },
        data: {
          viewCount: 100,
          likeCount: 10,
          commentCount: 2,
          statsUpdatedAt: expect.any(Date),
        },
      });
    });

    it('fetches and persists Instagram stats via the Instagram client', async () => {
      publishRecordFindManyMock.mockResolvedValue([instagramRecord]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        instagramRecord.socialAccount,
        expect.any(FakeInstagramOAuthClient),
      );
      expect(fetchInstagramMediaStatsMock).toHaveBeenCalledWith('plaintext-access', 'ig-media-1');
      expect(fetchYouTubeVideoStatsMock).not.toHaveBeenCalled();
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-2' },
        data: {
          viewCount: 200,
          likeCount: 20,
          commentCount: 4,
          statsUpdatedAt: expect.any(Date),
        },
      });
    });

    it('persists refreshed tokens on the social account when resolveAccessToken refreshes', async () => {
      publishRecordFindManyMock.mockResolvedValue([youtubeRecord]);
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
      await processor({});

      expect(socialAccountUpdateMock).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: {
          accessToken: 'new-encrypted-access',
          refreshToken: 'new-encrypted-refresh',
          tokenExpiresAt: new Date('2099-02-01'),
        },
      });
      expect(fetchYouTubeVideoStatsMock).toHaveBeenCalledWith('new-plaintext-access', 'yt-video-1');
    });

    it('skips a record with no platformPostId', async () => {
      publishRecordFindManyMock.mockResolvedValue([{ ...youtubeRecord, platformPostId: null }]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).not.toHaveBeenCalled();
      expect(fetchYouTubeVideoStatsMock).not.toHaveBeenCalled();
      expect(publishRecordUpdateMock).not.toHaveBeenCalled();
    });

    it('isolates a failing record - reports to Sentry and still syncs the rest of the batch', async () => {
      const error = new Error('YouTube API quota exceeded');
      fetchYouTubeVideoStatsMock.mockRejectedValueOnce(error);
      publishRecordFindManyMock.mockResolvedValue([youtubeRecord, instagramRecord]);

      const processor = getProcessor();
      await processor({});

      expect(captureExceptionMock).toHaveBeenCalledWith(error, {
        tags: { publishRecordId: 'record-1', socialAccountId: 'account-1' },
      });
      // The failing YouTube record's own update never happens...
      expect(publishRecordUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'record-1' } }),
      );
      // ...but the Instagram record after it still gets synced.
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-2' },
        data: {
          viewCount: 200,
          likeCount: 20,
          commentCount: 4,
          statsUpdatedAt: expect.any(Date),
        },
      });
    });

    it('does nothing when there are no published records to sync', async () => {
      publishRecordFindManyMock.mockResolvedValue([]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).not.toHaveBeenCalled();
      expect(publishRecordUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe('TikTok records', () => {
    it('checks publish status, and once a video id is available, fetches and persists real stats', async () => {
      publishRecordFindManyMock.mockResolvedValue([tiktokRecord]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        tiktokRecord.socialAccount,
        expect.any(FakeTikTokOAuthClient),
      );
      expect(fetchTikTokPublishStatusMock).toHaveBeenCalledWith(
        'plaintext-access',
        'tiktok-publish-1',
      );
      expect(fetchTikTokVideoStatsMock).toHaveBeenCalledWith('plaintext-access', 'tiktok-video-1');
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-3' },
        data: {
          viewCount: 300,
          likeCount: 30,
          commentCount: 6,
          statsUpdatedAt: expect.any(Date),
        },
      });
    });

    it('skips (without erroring) a TikTok record still pending in the inbox', async () => {
      fetchTikTokPublishStatusMock.mockResolvedValue({
        status: 'SEND_TO_USER_INBOX',
        videoId: null,
      });
      publishRecordFindManyMock.mockResolvedValue([tiktokRecord]);

      const processor = getProcessor();
      await processor({});

      expect(fetchTikTokVideoStatsMock).not.toHaveBeenCalled();
      expect(publishRecordUpdateMock).not.toHaveBeenCalled();
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });
  });
});
