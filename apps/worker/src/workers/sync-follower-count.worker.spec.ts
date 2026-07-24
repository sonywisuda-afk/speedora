import { SocialPlatform } from '@speedora/database';
import { QueueName } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const resolveAccessTokenMock = jest.fn();
const fetchYouTubeFollowerCountMock = jest.fn();
const fetchInstagramFollowerCountMock = jest.fn();
const fetchFacebookFollowerCountMock = jest.fn();
const fetchPinterestFollowerCountMock = jest.fn();
const fetchXFollowerCountMock = jest.fn();
const fetchTikTokFollowerCountMock = jest.fn();
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
  fetchYouTubeFollowerCount: (...args: unknown[]) => fetchYouTubeFollowerCountMock(...args),
  fetchInstagramFollowerCount: (...args: unknown[]) => fetchInstagramFollowerCountMock(...args),
  fetchFacebookFollowerCount: (...args: unknown[]) => fetchFacebookFollowerCountMock(...args),
  fetchPinterestFollowerCount: (...args: unknown[]) => fetchPinterestFollowerCountMock(...args),
  fetchXFollowerCount: (...args: unknown[]) => fetchXFollowerCountMock(...args),
  fetchTikTokFollowerCount: (...args: unknown[]) => fetchTikTokFollowerCountMock(...args),
  // Only used by other adapter methods (publish/syncStats) - unused here
  // but the module mock must still provide them so platform-registry.ts's
  // top-level construction doesn't throw.
  fetchYouTubeVideoStats: jest.fn(),
  fetchInstagramMediaStats: jest.fn(),
  fetchTikTokPublishStatus: jest.fn(),
  fetchTikTokVideoStats: jest.fn(),
  fetchFacebookVideoStats: jest.fn(),
  fetchThreadsPostStats: jest.fn(),
  fetchLinkedInPostStats: jest.fn(),
  fetchPinterestPinStats: jest.fn(),
  fetchXTweetStats: jest.fn(),
  YouTubeOAuthClient: FakeYouTubeOAuthClient,
  InstagramOAuthClient: FakeInstagramOAuthClient,
  TikTokOAuthClient: FakeTikTokOAuthClient,
  FacebookOAuthClient: FakeFacebookOAuthClient,
  ThreadsOAuthClient: FakeThreadsOAuthClient,
  LinkedInOAuthClient: FakeLinkedInOAuthClient,
  PinterestOAuthClient: FakePinterestOAuthClient,
  XOAuthClient: FakeXOAuthClient,
}));

const socialAccountFindManyMock = jest.fn();
const socialAccountUpdateMock = jest.fn();
const followerSnapshotCreateMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    socialAccount: {
      findMany: (...args: unknown[]) => socialAccountFindManyMock(...args),
      update: (...args: unknown[]) => socialAccountUpdateMock(...args),
    },
    socialAccountFollowerSnapshot: {
      create: (...args: unknown[]) => followerSnapshotCreateMock(...args),
    },
  },
}));

const syncFollowerCountQueueAddMock = jest.fn();
jest.mock('../queues', () => ({
  syncFollowerCountQueue: { add: (...args: unknown[]) => syncFollowerCountQueueAddMock(...args) },
}));

import { createSyncFollowerCountWorker, scheduleRepeatingTrigger } from './sync-follower-count.worker';

function getProcessor() {
  createSyncFollowerCountWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: unknown) => Promise<unknown>;
}

const youtubeAccount = {
  id: 'account-1',
  platform: SocialPlatform.YOUTUBE,
  platformAccountId: 'channel-1',
  accessToken: 'encrypted-access',
  refreshToken: 'encrypted-refresh',
  tokenExpiresAt: new Date('2099-01-01'),
  consecutiveSyncFailures: 0,
};

const instagramAccount = {
  id: 'account-2',
  platform: SocialPlatform.INSTAGRAM,
  platformAccountId: 'ig-user-1',
  accessToken: 'encrypted-access-2',
  refreshToken: 'encrypted-refresh-2',
  tokenExpiresAt: new Date('2099-01-01'),
  consecutiveSyncFailures: 0,
};

const tiktokAccount = {
  id: 'account-3',
  platform: SocialPlatform.TIKTOK,
  platformAccountId: 'tiktok-open-id',
  accessToken: 'encrypted-access-3',
  refreshToken: 'encrypted-refresh-3',
  tokenExpiresAt: new Date('2099-01-01'),
  consecutiveSyncFailures: 0,
};

describe('sync-follower-count worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    socialAccountFindManyMock.mockResolvedValue([]);
    socialAccountUpdateMock.mockResolvedValue({});
    followerSnapshotCreateMock.mockResolvedValue({});
    resolveAccessTokenMock.mockResolvedValue({ accessToken: 'plaintext-access', refreshed: false });
    fetchYouTubeFollowerCountMock.mockResolvedValue(1000);
    fetchInstagramFollowerCountMock.mockResolvedValue(2000);
    fetchTikTokFollowerCountMock.mockResolvedValue(3000);
  });

  describe('scheduleRepeatingTrigger', () => {
    it('registers the repeatable trigger daily with a fixed jobId', async () => {
      await scheduleRepeatingTrigger();

      expect(syncFollowerCountQueueAddMock).toHaveBeenCalledWith(
        QueueName.SYNC_FOLLOWER_COUNT,
        {},
        { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: 'sync-follower-count-poll' },
      );
    });
  });

  describe('processor', () => {
    it('queries accounts on platforms with a fetchFollowerCount adapter - excludes LinkedIn/Threads', async () => {
      const processor = getProcessor();
      await processor({});

      expect(socialAccountFindManyMock).toHaveBeenCalledWith({
        where: {
          platform: {
            in: expect.arrayContaining([
              SocialPlatform.YOUTUBE,
              SocialPlatform.INSTAGRAM,
              SocialPlatform.FACEBOOK,
              SocialPlatform.PINTEREST,
              SocialPlatform.X,
              SocialPlatform.TIKTOK,
            ]),
          },
        },
      });
      const inArg = socialAccountFindManyMock.mock.calls[0][0].where.platform.in;
      expect(inArg).toHaveLength(6);
      expect(inArg).not.toContain(SocialPlatform.LINKEDIN);
      expect(inArg).not.toContain(SocialPlatform.THREADS);
    });

    it('fetches and persists a follower snapshot for a "whoami"-style platform (YouTube)', async () => {
      socialAccountFindManyMock.mockResolvedValue([youtubeAccount]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).toHaveBeenCalledWith(
        youtubeAccount,
        expect.any(FakeYouTubeOAuthClient),
      );
      expect(fetchYouTubeFollowerCountMock).toHaveBeenCalledWith('plaintext-access');
      expect(followerSnapshotCreateMock).toHaveBeenCalledWith({
        data: { socialAccountId: 'account-1', followerCount: 1000 },
      });
    });

    it('fetches and persists a follower snapshot for an account-id-scoped platform (Instagram)', async () => {
      socialAccountFindManyMock.mockResolvedValue([instagramAccount]);

      const processor = getProcessor();
      await processor({});

      expect(fetchInstagramFollowerCountMock).toHaveBeenCalledWith('plaintext-access', 'ig-user-1');
      expect(followerSnapshotCreateMock).toHaveBeenCalledWith({
        data: { socialAccountId: 'account-2', followerCount: 2000 },
      });
    });

    it('persists refreshed tokens on the social account when resolveAccessToken refreshes', async () => {
      socialAccountFindManyMock.mockResolvedValue([youtubeAccount]);
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
    });

    it('isolates a failing account (e.g. TikTok not yet reconnected for user.info.stats) - reports to Sentry, no snapshot row, rest of the batch still syncs', async () => {
      const error = new Error('scope_not_authorized');
      fetchTikTokFollowerCountMock.mockRejectedValueOnce(error);
      socialAccountFindManyMock.mockResolvedValue([tiktokAccount, youtubeAccount]);

      const processor = getProcessor();
      await processor({});

      expect(captureExceptionMock).toHaveBeenCalledWith(error, {
        tags: { socialAccountId: 'account-3' },
      });
      expect(followerSnapshotCreateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ socialAccountId: 'account-3' }) }),
      );
      // The YouTube account after it still gets synced.
      expect(followerSnapshotCreateMock).toHaveBeenCalledWith({
        data: { socialAccountId: 'account-1', followerCount: 1000 },
      });
    });

    it('resets consecutiveSyncFailures to 0 on a successful sync', async () => {
      socialAccountFindManyMock.mockResolvedValue([
        { ...youtubeAccount, consecutiveSyncFailures: 2 },
      ]);

      const processor = getProcessor();
      await processor({});

      expect(socialAccountUpdateMock).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { consecutiveSyncFailures: 0 },
      });
    });

    it('does not touch consecutiveSyncFailures on success when it is already 0', async () => {
      socialAccountFindManyMock.mockResolvedValue([youtubeAccount]);

      const processor = getProcessor();
      await processor({});

      expect(socialAccountUpdateMock).not.toHaveBeenCalled();
    });

    it('increments consecutiveSyncFailures and sets lastSyncFailureAt when an account fails', async () => {
      const error = new Error('scope_not_authorized');
      fetchTikTokFollowerCountMock.mockRejectedValueOnce(error);
      socialAccountFindManyMock.mockResolvedValue([tiktokAccount]);

      const processor = getProcessor();
      await processor({});

      expect(socialAccountUpdateMock).toHaveBeenCalledWith({
        where: { id: 'account-3' },
        data: { consecutiveSyncFailures: { increment: 1 }, lastSyncFailureAt: expect.any(Date) },
      });
    });

    it('does nothing when there are no eligible accounts to sync', async () => {
      socialAccountFindManyMock.mockResolvedValue([]);

      const processor = getProcessor();
      await processor({});

      expect(resolveAccessTokenMock).not.toHaveBeenCalled();
      expect(followerSnapshotCreateMock).not.toHaveBeenCalled();
    });
  });
});
