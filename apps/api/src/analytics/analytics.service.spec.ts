import { PublishStatus, SocialPlatform, VideoStatus } from '@speedora/database';
import type { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: {
    video: { count: jest.Mock; findMany: jest.Mock };
    clip: { count: jest.Mock };
    publishRecordStatsSnapshot: { findMany: jest.Mock };
    publishRecord: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      video: { count: jest.fn(), findMany: jest.fn() },
      clip: { count: jest.fn() },
      publishRecordStatsSnapshot: { findMany: jest.fn() },
      publishRecord: { findMany: jest.fn() },
    };
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  describe('getOverview', () => {
    it('scopes every query to the requesting user', async () => {
      prisma.video.count.mockResolvedValue(3);
      prisma.clip.count.mockResolvedValue(10);
      prisma.publishRecordStatsSnapshot.findMany.mockResolvedValue([]);
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
      expect(prisma.publishRecordStatsSnapshot.findMany).toHaveBeenCalledWith({
        where: { publishRecord: { clip: { video: { ownerId: 'user-1' } } } },
        select: { publishRecordId: true, capturedAt: true, engagementScore: true },
      });
      expect(prisma.publishRecord.findMany).toHaveBeenCalledWith({
        where: { status: PublishStatus.PUBLISHED, clip: { video: { ownerId: 'user-1' } } },
        select: { socialAccount: { select: { platform: true } } },
      });
    });

    it('assembles totals, platform breakdown, processing status, and engagement from the fetched rows', async () => {
      prisma.video.count.mockResolvedValue(2);
      prisma.clip.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
      prisma.publishRecordStatsSnapshot.findMany.mockResolvedValue([
        { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-01'), engagementScore: 0.4 },
      ]);
      // Relative to the real clock (not a hardcoded date) - getOverview()
      // doesn't accept an injected `now`, so bucketUploadsByDay's 30-day
      // window is anchored to whenever this test actually runs.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      prisma.video.findMany.mockResolvedValue([
        { status: VideoStatus.RENDERED, createdAt: yesterday },
        { status: VideoStatus.FAILED, createdAt: yesterday },
      ]);
      prisma.publishRecord.findMany.mockResolvedValue([
        { socialAccount: { platform: SocialPlatform.YOUTUBE } },
        { socialAccount: { platform: SocialPlatform.YOUTUBE } },
        { socialAccount: { platform: SocialPlatform.TIKTOK } },
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

    it('returns null averageEngagementScore and empty breakdowns when the user has no data', async () => {
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);
      prisma.publishRecordStatsSnapshot.findMany.mockResolvedValue([]);
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
    it('computes engagement trend, platform comparison (all 3 platforms, even with 0 data), and AI summary', async () => {
      const today = new Date();
      prisma.publishRecord.findMany
        .mockResolvedValueOnce([fixtureRecord({ id: 'pr-current', publishedAt: today })]) // current window
        .mockResolvedValueOnce([]); // previous window
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);

      const result = await service.getPerformance('user-1', { days: 30 });

      expect(result.engagementTrend.reduce((sum, d) => sum + d.publishCount, 0)).toBe(1);
      expect(result.platformComparison).toHaveLength(3);
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
});
