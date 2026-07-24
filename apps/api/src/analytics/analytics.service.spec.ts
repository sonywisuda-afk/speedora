import { PublishStatus, SocialPlatform, VideoStatus } from '@speedora/database';
import type { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: {
    video: { count: jest.Mock; findMany: jest.Mock };
    clip: { count: jest.Mock };
    publishRecord: { findMany: jest.Mock };
    socialAccount: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      video: { count: jest.fn(), findMany: jest.fn() },
      clip: { count: jest.fn() },
      publishRecord: { findMany: jest.fn() },
      socialAccount: { findMany: jest.fn() },
    };
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  describe('getOverview', () => {
    it('scopes every query to the requesting user', async () => {
      prisma.video.count.mockResolvedValue(3);
      prisma.clip.count.mockResolvedValue(10);
      prisma.video.findMany.mockResolvedValue([]);
      prisma.publishRecord.findMany.mockResolvedValue([]);

      await service.getOverview('user-1');

      expect(prisma.video.count).toHaveBeenCalledWith({ where: { ownerId: 'user-1' } });
      expect(prisma.clip.count).toHaveBeenNthCalledWith(1, {
        where: { video: { ownerId: 'user-1' } },
      });
      expect(prisma.clip.count).toHaveBeenNthCalledWith(2, {
        where: {
          video: { ownerId: 'user-1' },
          publishRecords: { some: { status: PublishStatus.PUBLISHED } },
        },
      });
      // Stabilization Pass Area 5 tech-debt fix - platform breakdown and
      // engagement average are now read from a single query, using a nested
      // `statsSnapshots: { orderBy, take: 1 }` (latest snapshot per record)
      // instead of a second, unbounded publishRecordStatsSnapshot.findMany().
      expect(prisma.publishRecord.findMany).toHaveBeenCalledWith({
        where: { status: PublishStatus.PUBLISHED, clip: { video: { ownerId: 'user-1' } } },
        select: {
          id: true,
          socialAccount: { select: { platform: true } },
          statsSnapshots: {
            orderBy: { capturedAt: 'desc' },
            take: 1,
            select: { capturedAt: true, engagementScore: true },
          },
        },
      });
    });

    it('assembles totals, platform breakdown, processing status, and engagement from the fetched rows', async () => {
      prisma.video.count.mockResolvedValue(2);
      prisma.clip.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
      // Relative to the real clock (not a hardcoded date) - getOverview()
      // doesn't accept an injected `now`, so bucketUploadsByDay's 30-day
      // window is anchored to whenever this test actually runs.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      prisma.video.findMany.mockResolvedValue([
        { status: VideoStatus.RENDERED, createdAt: yesterday },
        { status: VideoStatus.FAILED, createdAt: yesterday },
      ]);
      prisma.publishRecord.findMany.mockResolvedValue([
        {
          id: 'pr-1',
          socialAccount: { platform: SocialPlatform.YOUTUBE },
          statsSnapshots: [
            { capturedAt: new Date('2026-01-01'), engagementScore: 0.4 },
          ],
        },
        { id: 'pr-2', socialAccount: { platform: SocialPlatform.YOUTUBE }, statsSnapshots: [] },
        { id: 'pr-3', socialAccount: { platform: SocialPlatform.TIKTOK }, statsSnapshots: [] },
      ]);

      const result = await service.getOverview('user-1');

      expect(result.totalVideos).toBe(2);
      expect(result.totalClips).toBe(5);
      expect(result.publishedClips).toBe(1);
      expect(result.averageEngagementScore).toBe(0.4);
      expect(result.platformBreakdown).toEqual(
        expect.arrayContaining([
          { platform: SocialPlatform.YOUTUBE, publishedCount: 2 },
          { platform: SocialPlatform.TIKTOK, publishedCount: 1 },
        ]),
      );
      expect(result.processingStatus).toEqual(
        expect.arrayContaining([
          { status: VideoStatus.RENDERED, count: 1 },
          { status: VideoStatus.FAILED, count: 1 },
        ]),
      );
      expect(result.uploadTrend.length).toBe(30);
      expect(result.uploadTrend.reduce((sum, d) => sum + d.count, 0)).toBe(2);
    });

    it('averages the latest snapshot per record, ignoring older snapshots from the same record', async () => {
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);
      prisma.video.findMany.mockResolvedValue([]);
      prisma.publishRecord.findMany.mockResolvedValue([
        {
          id: 'pr-1',
          socialAccount: { platform: SocialPlatform.YOUTUBE },
          // Only the latest snapshot is ever fetched (take: 1) - this test
          // documents that expectation even though the service itself no
          // longer has to pick "latest" out of a larger set.
          statsSnapshots: [{ capturedAt: new Date('2026-02-01'), engagementScore: 0.8 }],
        },
        {
          id: 'pr-2',
          socialAccount: { platform: SocialPlatform.TIKTOK },
          statsSnapshots: [{ capturedAt: new Date('2026-02-01'), engagementScore: 0.2 }],
        },
      ]);

      const result = await service.getOverview('user-1');

      expect(result.averageEngagementScore).toBe(0.5);
    });

    it('returns null averageEngagementScore and empty breakdowns when the user has no data', async () => {
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);
      prisma.video.findMany.mockResolvedValue([]);
      prisma.publishRecord.findMany.mockResolvedValue([]);

      const result = await service.getOverview('user-1');

      expect(result.averageEngagementScore).toBeNull();
      expect(result.platformBreakdown).toEqual([]);
      expect(result.processingStatus).toEqual([]);
      expect(result.uploadTrend.every((d) => d.count === 0)).toBe(true);
    });
  });

  function fixtureRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pr-1',
      publishedAt: new Date(),
      clip: {
        id: 'clip-1',
        videoId: 'video-1',
        hookText: 'A great hook',
        highlightScore: 70,
        highlightConfidence: 0.8,
        highlightReason: 'Strong hook and energy.',
        highlightExplainability: {
          topFactors: [
            {
              signal: 'audio',
              feature: 'averageRmsDb',
              weightedContribution: 0.2,
              description: 'Loud audio',
            },
          ],
        },
        highlightBreakdown: [
          {
            signal: 'audio',
            feature: 'averageRmsDb',
            rawValue: -20,
            normalizedValue: 0.6,
            weight: 0.5,
            weightedContribution: 0.2,
          },
        ],
      },
      socialAccount: { platform: SocialPlatform.YOUTUBE },
      statsSnapshots: [
        { viewCount: 100, likeCount: 10, commentCount: 2, shareCount: 1, engagementScore: 0.3 },
      ],
      ...overrides,
    };
  }

  describe('getPerformanceClips', () => {
    it('maps published records into TopClipRow, sorted by engagementScore descending by default', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        fixtureRecord({
          id: 'pr-low',
          statsSnapshots: [
            { viewCount: 10, likeCount: 1, commentCount: 0, shareCount: 0, engagementScore: 0.1 },
          ],
        }),
        fixtureRecord({
          id: 'pr-high',
          statsSnapshots: [
            { viewCount: 500, likeCount: 50, commentCount: 5, shareCount: 2, engagementScore: 0.9 },
          ],
        }),
      ]);

      const result = await service.getPerformanceClips('user-1', { days: 30 });

      expect(result.clips.map((c) => c.publishRecordId)).toEqual(['pr-high', 'pr-low']);
      expect(result.clips[0].engagementScore).toBe(0.9);
      expect(result.clips[0].videoLabel).toBe('A great hook');
      expect(result.clips[0].platform).toBe(SocialPlatform.YOUTUBE);
    });

    it('falls back to a generic video label when hookText is null', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        fixtureRecord({
          clip: { ...fixtureRecord().clip, hookText: null, videoId: 'video-abcdefgh' },
        }),
      ]);

      const result = await service.getPerformanceClips('user-1', { days: 30 });

      expect(result.clips[0].videoLabel).toBe('Video video-ab');
    });

    it('respects the limit option', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        fixtureRecord({ id: 'pr-1' }),
        fixtureRecord({ id: 'pr-2' }),
        fixtureRecord({ id: 'pr-3' }),
      ]);

      const result = await service.getPerformanceClips('user-1', { days: 30, limit: 2 });

      expect(result.clips).toHaveLength(2);
    });
  });

  describe('getPerformanceVideos', () => {
    it('aggregates multiple publish records for the same video into one row', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        fixtureRecord({
          id: 'pr-1',
          clip: { ...fixtureRecord().clip, id: 'clip-1', videoId: 'video-1', highlightScore: 60 },
          statsSnapshots: [
            { viewCount: 100, likeCount: 10, commentCount: 0, shareCount: 1, engagementScore: 0.2 },
          ],
        }),
        fixtureRecord({
          id: 'pr-2',
          clip: { ...fixtureRecord().clip, id: 'clip-2', videoId: 'video-1', highlightScore: 80 },
          statsSnapshots: [
            { viewCount: 200, likeCount: 20, commentCount: 0, shareCount: 3, engagementScore: 0.4 },
          ],
        }),
      ]);

      const result = await service.getPerformanceVideos('user-1', { days: 30 });

      expect(result.videos).toHaveLength(1);
      const video = result.videos[0];
      expect(video.clipCount).toBe(2);
      expect(video.averageHighlightScore).toBe(70);
      expect(video.averageEngagementScore).toBeCloseTo(0.3);
      expect(video.totalViews).toBe(300);
      expect(video.totalLikes).toBe(30);
      expect(video.totalShares).toBe(4);
    });
  });

  describe('getPerformance', () => {
    it('computes engagement trend, platform comparison (all supported platforms, even with 0 data), and AI summary', async () => {
      const today = new Date();
      prisma.publishRecord.findMany
        .mockResolvedValueOnce([fixtureRecord({ id: 'pr-current', publishedAt: today })]) // current window
        .mockResolvedValueOnce([]); // previous window
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);

      const result = await service.getPerformance('user-1', { days: 30 });

      expect(result.engagementTrend.reduce((sum, d) => sum + d.publishCount, 0)).toBe(1);
      // All 8 supported platforms, not just YouTube/TikTok/Instagram -
      // Sprint 6A fixed platformComparison silently dropping
      // Facebook/Threads/LinkedIn/Pinterest/X.
      expect(result.platformComparison).toHaveLength(Object.values(SocialPlatform).length);
      const youtube = result.platformComparison.find((p) => p.platform === SocialPlatform.YOUTUBE)!;
      expect(youtube.publishCount).toBe(1);
      // 0 previous-period records -> no baseline to compare against.
      expect(youtube.growthPct).toBeNull();
      const tiktok = result.platformComparison.find((p) => p.platform === SocialPlatform.TIKTOK)!;
      expect(tiktok.publishCount).toBe(0);
      expect(result.aiSummary.averageHighlightScore).toBe(70);
      expect(result.aiSummary.mostCommonSignals).toEqual([{ signal: 'audio', count: 1 }]);
      expect(result.aiSummary.topHighlightReasons).toEqual([
        { clipId: 'clip-1', highlightScore: 70, reason: 'Strong hook and energy.' },
      ]);
      // Milestone 5C-A - score 70 falls in the '70-80' bucket.
      expect(result.aiSummary.scoreDistribution.find((b) => b.bucket === '70-80')?.count).toBe(1);
      expect(result.aiSummary.signalContributions).toEqual([
        { signal: 'audio', averageContributionPct: 100, clipsWithSignal: 1 },
      ]);
      // Growth Summary (Analytics Report) - 1 current record (viewCount 100,
      // engagementScore 0.3), 0 previous -> no baseline for any metric.
      expect(result.growthSummary.views).toEqual({ current: 100, previous: 0, growthPct: null });
      expect(result.growthSummary.engagementScore).toEqual({
        current: 0.3,
        previous: null,
        growthPct: null,
      });
      expect(result.growthSummary.videos).toEqual({ current: 0, previous: 0, growthPct: null });
      expect(result.growthSummary.clips).toEqual({ current: 0, previous: 0, growthPct: null });
    });

    it('deduplicates a clip published to multiple platforms for the AI summary', async () => {
      const today = new Date();
      prisma.publishRecord.findMany
        .mockResolvedValueOnce([
          fixtureRecord({
            id: 'pr-yt',
            publishedAt: today,
            socialAccount: { platform: SocialPlatform.YOUTUBE },
          }),
          fixtureRecord({
            id: 'pr-tt',
            publishedAt: today,
            socialAccount: { platform: SocialPlatform.TIKTOK },
          }),
        ])
        .mockResolvedValueOnce([]);
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);

      const result = await service.getPerformance('user-1', { days: 30 });

      // Same clip-1 on both platforms - AI summary counts it once.
      expect(result.aiSummary.mostCommonSignals).toEqual([{ signal: 'audio', count: 1 }]);
    });

    it('defaults to daily granularity and echoes it back on the response', async () => {
      prisma.publishRecord.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);

      const result = await service.getPerformance('user-1', { days: 30 });

      expect(result.granularity).toBe('daily');
    });

    it("buckets engagementTrend by ISO week when granularity is 'weekly'", async () => {
      const today = new Date();
      prisma.publishRecord.findMany
        .mockResolvedValueOnce([fixtureRecord({ id: 'pr-current', publishedAt: today })])
        .mockResolvedValueOnce([]);
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);

      const result = await service.getPerformance('user-1', { days: 90, granularity: 'weekly' });

      expect(result.granularity).toBe('weekly');
      expect(result.engagementTrend.reduce((sum, d) => sum + d.publishCount, 0)).toBe(1);
      // days=90 -> ~13 weekly buckets, not 90 daily ones.
      expect(result.engagementTrend.length).toBeLessThan(90);
    });

    it('computes a non-null growthPct when a prior-period baseline exists', async () => {
      prisma.publishRecord.findMany
        .mockResolvedValueOnce([fixtureRecord({ id: 'pr-1' }), fixtureRecord({ id: 'pr-2' })]) // 2 current
        .mockResolvedValueOnce([fixtureRecord({ id: 'pr-0' })]); // 1 previous
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);

      const result = await service.getPerformance('user-1', { days: 30 });

      const youtube = result.platformComparison.find((p) => p.platform === SocialPlatform.YOUTUBE)!;
      expect(youtube.growthPct).toBe(100);
    });

    it('computes growthSummary from windowed video/clip counts plus the same current/previous records used for engagementTrend', async () => {
      prisma.publishRecord.findMany
        .mockResolvedValueOnce([
          fixtureRecord({
            id: 'pr-1',
            statsSnapshots: [
              {
                viewCount: 100,
                likeCount: 10,
                commentCount: 2,
                shareCount: 1,
                engagementScore: 0.4,
              },
            ],
          }),
          fixtureRecord({
            id: 'pr-2',
            statsSnapshots: [
              { viewCount: 50, likeCount: 5, commentCount: 1, shareCount: 0, engagementScore: 0.6 },
            ],
          }),
        ])
        .mockResolvedValueOnce([
          fixtureRecord({
            id: 'pr-0',
            statsSnapshots: [
              {
                viewCount: 100,
                likeCount: 10,
                commentCount: 1,
                shareCount: 0,
                engagementScore: 0.5,
              },
            ],
          }),
        ]);
      prisma.video.count.mockResolvedValueOnce(8).mockResolvedValueOnce(5);
      prisma.clip.count.mockResolvedValueOnce(20).mockResolvedValueOnce(10);

      const result = await service.getPerformance('user-1', { days: 30 });

      expect(result.growthSummary.views).toEqual({ current: 150, previous: 100, growthPct: 50 });
      expect(result.growthSummary.engagementScore.current).toBeCloseTo(0.5);
      expect(result.growthSummary.engagementScore.previous).toBe(0.5);
      expect(result.growthSummary.engagementScore.growthPct).toBe(0);
      expect(result.growthSummary.videos).toEqual({ current: 8, previous: 5, growthPct: 60 });
      expect(result.growthSummary.clips).toEqual({ current: 20, previous: 10, growthPct: 100 });
    });
  });

  describe('getFollowers', () => {
    it('scopes the query to the requesting user', async () => {
      prisma.socialAccount.findMany.mockResolvedValue([]);

      await service.getFollowers('user-1', 30);

      expect(prisma.socialAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it("derives latestFollowerCount from the newest snapshot, and returns real history oldest-first", async () => {
      prisma.socialAccount.findMany.mockResolvedValue([
        {
          id: 'account-1',
          platform: SocialPlatform.YOUTUBE,
          displayName: 'My Channel',
          followerSnapshots: [
            { capturedAt: new Date('2026-07-01T00:00:00.000Z'), followerCount: 100 },
            { capturedAt: new Date('2026-07-02T00:00:00.000Z'), followerCount: 110 },
          ],
        },
      ]);

      const result = await service.getFollowers('user-1', 30);

      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].latestFollowerCount).toBe(110);
      expect(result.accounts[0].history).toEqual([
        { capturedAt: '2026-07-01T00:00:00.000Z', followerCount: 100 },
        { capturedAt: '2026-07-02T00:00:00.000Z', followerCount: 110 },
      ]);
    });

    it('reports latestFollowerCount: null and empty history for an account with no snapshots yet (unavailable platform or not-yet-reconnected)', async () => {
      prisma.socialAccount.findMany.mockResolvedValue([
        {
          id: 'account-2',
          platform: SocialPlatform.LINKEDIN,
          displayName: 'My LinkedIn',
          followerSnapshots: [],
        },
      ]);

      const result = await service.getFollowers('user-1', 30);

      expect(result.accounts[0].latestFollowerCount).toBeNull();
      expect(result.accounts[0].history).toEqual([]);
    });
  });

  describe('getHeatmap', () => {
    it('returns 168 zero-filled cells for an account with no published records', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([]);

      const result = await service.getHeatmap('user-1', 30);

      expect(result.cells).toHaveLength(168);
      expect(result.cells.every((c) => c.publishCount === 0)).toBe(true);
    });

    it('buckets a real published record by its publishedAt day/hour', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        fixtureRecord({
          publishedAt: new Date('2026-07-19T14:00:00.000Z'), // Sunday 14:00 UTC
          statsSnapshots: [
            { viewCount: 100, likeCount: 10, commentCount: 2, shareCount: 1, engagementScore: 0.19 },
          ],
        }),
      ]);

      const result = await service.getHeatmap('user-1', 30);

      const cell = result.cells.find((c) => c.dayOfWeek === 0 && c.hour === 14)!;
      expect(cell.publishCount).toBe(1);
      expect(cell.totalViews).toBe(100);
      expect(cell.averageEngagementScore).toBeCloseTo(0.19);
    });

    it('always reports retention/dropOff/replay as unavailable, honestly, in v1', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([]);

      const result = await service.getHeatmap('user-1', 30);

      expect(result.retention.available).toBe(false);
      expect(result.retention.reason).toBeTruthy();
      expect(result.dropOff.available).toBe(false);
      expect(result.replay.available).toBe(false);
    });
  });
});
