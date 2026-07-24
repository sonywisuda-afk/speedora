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
const fetchFacebookVideoStatsMock = jest.fn();
const fetchThreadsPostStatsMock = jest.fn();
const fetchLinkedInPostStatsMock = jest.fn();
const fetchPinterestPinStatsMock = jest.fn();
const fetchXTweetStatsMock = jest.fn();
const computeEngagementScoreMock = jest.fn();
class FakeYouTubeOAuthClient {}
class FakeInstagramOAuthClient {}
class FakeTikTokOAuthClient {}
class FakeFacebookOAuthClient {}
class FakeThreadsOAuthClient {}
class FakeLinkedInOAuthClient {}
class FakePinterestOAuthClient {}
class FakeXOAuthClient {}
jest.mock('@speedora/social', () => ({
  resolveAccessToken: (...args: unknown[]) => resolveAccessTokenMock(...args),
  fetchYouTubeVideoStats: (...args: unknown[]) => fetchYouTubeVideoStatsMock(...args),
  fetchInstagramMediaStats: (...args: unknown[]) => fetchInstagramMediaStatsMock(...args),
  fetchTikTokPublishStatus: (...args: unknown[]) => fetchTikTokPublishStatusMock(...args),
  fetchTikTokVideoStats: (...args: unknown[]) => fetchTikTokVideoStatsMock(...args),
  fetchFacebookVideoStats: (...args: unknown[]) => fetchFacebookVideoStatsMock(...args),
  fetchThreadsPostStats: (...args: unknown[]) => fetchThreadsPostStatsMock(...args),
  fetchLinkedInPostStats: (...args: unknown[]) => fetchLinkedInPostStatsMock(...args),
  fetchPinterestPinStats: (...args: unknown[]) => fetchPinterestPinStatsMock(...args),
  fetchXTweetStats: (...args: unknown[]) => fetchXTweetStatsMock(...args),
  computeEngagementScore: (...args: unknown[]) => computeEngagementScoreMock(...args),
  YouTubeOAuthClient: FakeYouTubeOAuthClient,
  InstagramOAuthClient: FakeInstagramOAuthClient,
  TikTokOAuthClient: FakeTikTokOAuthClient,
  FacebookOAuthClient: FakeFacebookOAuthClient,
  ThreadsOAuthClient: FakeThreadsOAuthClient,
  LinkedInOAuthClient: FakeLinkedInOAuthClient,
  PinterestOAuthClient: FakePinterestOAuthClient,
  XOAuthClient: FakeXOAuthClient,
}));

const publishRecordFindManyMock = jest.fn();
const publishRecordUpdateMock = jest.fn();
const publishRecordStatsSnapshotCreateMock = jest.fn();
const socialAccountUpdateMock = jest.fn();
const socialAccountUpdateManyMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    publishRecord: {
      findMany: (...args: unknown[]) => publishRecordFindManyMock(...args),
      update: (...args: unknown[]) => publishRecordUpdateMock(...args),
    },
    publishRecordStatsSnapshot: {
      create: (...args: unknown[]) => publishRecordStatsSnapshotCreateMock(...args),
    },
    socialAccount: {
      update: (...args: unknown[]) => socialAccountUpdateMock(...args),
      updateMany: (...args: unknown[]) => socialAccountUpdateManyMock(...args),
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

const linkedinRecord = {
  id: 'record-4',
  socialAccountId: 'account-4',
  platformPostId: 'urn:li:share:1',
  socialAccount: {
    id: 'account-4',
    platform: SocialPlatform.LINKEDIN,
    accessToken: 'encrypted-access-4',
    refreshToken: 'encrypted-refresh-4',
    tokenExpiresAt: new Date('2099-01-01'),
  },
};

const pinterestRecord = {
  id: 'record-5',
  socialAccountId: 'account-5',
  platformPostId: 'pin-1',
  socialAccount: {
    id: 'account-5',
    platform: SocialPlatform.PINTEREST,
    accessToken: 'encrypted-access-5',
    refreshToken: 'encrypted-refresh-5',
    tokenExpiresAt: new Date('2099-01-01'),
  },
};

const xRecord = {
  id: 'record-6',
  socialAccountId: 'account-6',
  platformPostId: 'tweet-1',
  socialAccount: {
    id: 'account-6',
    platform: SocialPlatform.X,
    accessToken: 'encrypted-access-6',
    refreshToken: 'encrypted-refresh-6',
    tokenExpiresAt: new Date('2099-01-01'),
  },
};

describe('sync-publish-stats worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publishRecordFindManyMock.mockResolvedValue([]);
    publishRecordUpdateMock.mockResolvedValue({});
    publishRecordStatsSnapshotCreateMock.mockResolvedValue({});
    socialAccountUpdateMock.mockResolvedValue({});
    socialAccountUpdateManyMock.mockResolvedValue({ count: 0 });
    resolveAccessTokenMock.mockResolvedValue({ accessToken: 'plaintext-access', refreshed: false });
    computeEngagementScoreMock.mockReturnValue(0.5);
    fetchYouTubeVideoStatsMock.mockResolvedValue({
      viewCount: 100,
      likeCount: 10,
      commentCount: 2,
    });
    fetchInstagramMediaStatsMock.mockResolvedValue({
      viewCount: 200,
      likeCount: 20,
      commentCount: 4,
      shareCount: 5,
      watchTimeSeconds: 8.2,
    });
    fetchTikTokPublishStatusMock.mockResolvedValue({
      status: 'PUBLISH_COMPLETE',
      videoId: 'tiktok-video-1',
    });
    fetchTikTokVideoStatsMock.mockResolvedValue({
      viewCount: 300,
      likeCount: 30,
      commentCount: 6,
      shareCount: 9,
    });
    fetchLinkedInPostStatsMock.mockResolvedValue({
      viewCount: null,
      likeCount: 40,
      commentCount: 8,
      shareCount: null,
      watchTimeSeconds: null,
    });
    fetchPinterestPinStatsMock.mockResolvedValue({
      viewCount: 500,
      likeCount: 12,
      commentCount: null,
      shareCount: null,
      watchTimeSeconds: null,
    });
    fetchXTweetStatsMock.mockResolvedValue({
      viewCount: 800,
      likeCount: 25,
      commentCount: 3,
      shareCount: 4,
      watchTimeSeconds: null,
    });
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
              in: expect.arrayContaining([
                SocialPlatform.YOUTUBE,
                SocialPlatform.INSTAGRAM,
                SocialPlatform.TIKTOK,
              ]),
            },
          },
        },
        include: { socialAccount: true },
      });
      // Also includes FACEBOOK/THREADS (Phase 1), LINKEDIN (Phase 2),
      // PINTEREST (Phase 3), and X (Phase 4) since all define syncStats -
      // platformsWithStatsSync() derives this list rather than a second
      // hand-maintained platform array.
      const inArg = publishRecordFindManyMock.mock.calls[0][0].where.socialAccount.platform.in;
      expect(inArg).toHaveLength(8);
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
      // YouTube's stats client reports neither shares nor watch-time today.
      expect(publishRecordStatsSnapshotCreateMock).toHaveBeenCalledWith({
        data: {
          publishRecordId: 'record-1',
          viewCount: 100,
          likeCount: 10,
          commentCount: 2,
          shareCount: null,
          watchTimeSeconds: null,
          engagementScore: 0.5,
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
      expect(publishRecordStatsSnapshotCreateMock).toHaveBeenCalledWith({
        data: {
          publishRecordId: 'record-2',
          viewCount: 200,
          likeCount: 20,
          commentCount: 4,
          shareCount: 5,
          watchTimeSeconds: 8.2,
          engagementScore: 0.5,
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
      expect(publishRecordStatsSnapshotCreateMock).not.toHaveBeenCalled();
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

    it('resets consecutiveSyncFailures to 0 on a successful sync', async () => {
      publishRecordFindManyMock.mockResolvedValue([youtubeRecord]);

      const processor = getProcessor();
      await processor({});

      expect(socialAccountUpdateManyMock).toHaveBeenCalledWith({
        where: { id: 'account-1', consecutiveSyncFailures: { gt: 0 } },
        data: { consecutiveSyncFailures: 0 },
      });
      expect(socialAccountUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ consecutiveSyncFailures: expect.anything() }) }),
      );
    });

    it('increments consecutiveSyncFailures and sets lastSyncFailureAt when every record for an account fails', async () => {
      const error = new Error('token revoked');
      fetchYouTubeVideoStatsMock.mockRejectedValueOnce(error);
      publishRecordFindManyMock.mockResolvedValue([youtubeRecord]);

      const processor = getProcessor();
      await processor({});

      expect(socialAccountUpdateMock).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { consecutiveSyncFailures: { increment: 1 }, lastSyncFailureAt: expect.any(Date) },
      });
      expect(socialAccountUpdateManyMock).not.toHaveBeenCalled();
    });

    it('treats the account as healthy when at least one of its records succeeds this tick, even if another fails', async () => {
      const error = new Error('this specific post was deleted on the platform');
      const secondYoutubeRecord = { ...youtubeRecord, id: 'record-1b', platformPostId: 'yt-video-1b' };
      fetchYouTubeVideoStatsMock.mockRejectedValueOnce(error).mockResolvedValueOnce({
        viewCount: 100,
        likeCount: 10,
        commentCount: 2,
      });
      publishRecordFindManyMock.mockResolvedValue([youtubeRecord, secondYoutubeRecord]);

      const processor = getProcessor();
      await processor({});

      expect(socialAccountUpdateManyMock).toHaveBeenCalledWith({
        where: { id: 'account-1', consecutiveSyncFailures: { gt: 0 } },
        data: { consecutiveSyncFailures: 0 },
      });
      expect(socialAccountUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ consecutiveSyncFailures: expect.anything() }) }),
      );
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
      // TikTok has no watch-time endpoint on the current API surface.
      expect(publishRecordStatsSnapshotCreateMock).toHaveBeenCalledWith({
        data: {
          publishRecordId: 'record-3',
          viewCount: 300,
          likeCount: 30,
          commentCount: 6,
          shareCount: 9,
          watchTimeSeconds: null,
          engagementScore: 0.5,
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
      expect(publishRecordStatsSnapshotCreateMock).not.toHaveBeenCalled();
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });
  });

  describe('LinkedIn records', () => {
    it('fetches and persists LinkedIn stats via the LinkedIn client', async () => {
      publishRecordFindManyMock.mockResolvedValue([linkedinRecord]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        linkedinRecord.socialAccount,
        expect.any(FakeLinkedInOAuthClient),
      );
      expect(fetchLinkedInPostStatsMock).toHaveBeenCalledWith('plaintext-access', 'urn:li:share:1');
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-4' },
        data: {
          viewCount: null,
          likeCount: 40,
          commentCount: 8,
          statsUpdatedAt: expect.any(Date),
        },
      });
      // LinkedIn's Community Management API tier has no view/share/watch-time
      // metrics available for organic posts.
      expect(publishRecordStatsSnapshotCreateMock).toHaveBeenCalledWith({
        data: {
          publishRecordId: 'record-4',
          viewCount: null,
          likeCount: 40,
          commentCount: 8,
          shareCount: null,
          watchTimeSeconds: null,
          engagementScore: 0.5,
        },
      });
    });
  });

  describe('Pinterest records', () => {
    it('fetches and persists Pinterest stats via the Pinterest client', async () => {
      publishRecordFindManyMock.mockResolvedValue([pinterestRecord]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        pinterestRecord.socialAccount,
        expect.any(FakePinterestOAuthClient),
      );
      expect(fetchPinterestPinStatsMock).toHaveBeenCalledWith('plaintext-access', 'pin-1');
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-5' },
        data: {
          viewCount: 500,
          likeCount: 12,
          commentCount: null,
          statsUpdatedAt: expect.any(Date),
        },
      });
      // Pinterest has no comment/share/watch-time metric at this API tier.
      expect(publishRecordStatsSnapshotCreateMock).toHaveBeenCalledWith({
        data: {
          publishRecordId: 'record-5',
          viewCount: 500,
          likeCount: 12,
          commentCount: null,
          shareCount: null,
          watchTimeSeconds: null,
          engagementScore: 0.5,
        },
      });
    });
  });

  describe('X records', () => {
    it('fetches and persists X stats via the X client', async () => {
      publishRecordFindManyMock.mockResolvedValue([xRecord]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        xRecord.socialAccount,
        expect.any(FakeXOAuthClient),
      );
      expect(fetchXTweetStatsMock).toHaveBeenCalledWith('plaintext-access', 'tweet-1');
      expect(publishRecordUpdateMock).toHaveBeenCalledWith({
        where: { id: 'record-6' },
        data: {
          viewCount: 800,
          likeCount: 25,
          commentCount: 3,
          statsUpdatedAt: expect.any(Date),
        },
      });
      expect(publishRecordStatsSnapshotCreateMock).toHaveBeenCalledWith({
        data: {
          publishRecordId: 'record-6',
          viewCount: 800,
          likeCount: 25,
          commentCount: 3,
          shareCount: 4,
          watchTimeSeconds: null,
          engagementScore: 0.5,
        },
      });
    });
  });
});
