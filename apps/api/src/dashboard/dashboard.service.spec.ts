import type { AnalyticsService } from '../analytics/analytics.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    video: { count: jest.Mock; findMany: jest.Mock; aggregate: jest.Mock };
    clip: { count: jest.Mock; aggregate: jest.Mock };
    premiumCredit: { count: jest.Mock };
    activityEvent: { findMany: jest.Mock };
  };
  let analytics: { getOverview: jest.Mock; getPerformance: jest.Mock };

  beforeEach(() => {
    prisma = {
      video: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sourceSizeBytes: null } }),
      },
      clip: {
        count: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { outputSizeBytes: null } }),
      },
      premiumCredit: { count: jest.fn().mockResolvedValue(0) },
      activityEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    analytics = { getOverview: jest.fn(), getPerformance: jest.fn() };
    service = new DashboardService(
      prisma as unknown as PrismaService,
      analytics as unknown as AnalyticsService,
    );
  });

  describe('getStats', () => {
    it('returns totals, monthly counts, storage, and premium credits, scoped to the owner', async () => {
      // video.count is called twice (totalVideos, then monthlyVideos) -
      // Promise.all invokes them in source order, so mockResolvedValueOnce
      // chains match 1:1 with that order.
      prisma.video.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      prisma.clip.count.mockResolvedValueOnce(12).mockResolvedValueOnce(4);
      prisma.video.aggregate.mockResolvedValue({ _sum: { sourceSizeBytes: 1000 } });
      prisma.clip.aggregate.mockResolvedValue({ _sum: { outputSizeBytes: 2000 } });
      prisma.premiumCredit.count.mockResolvedValue(3);

      const result = await service.getStats('user-1');

      expect(prisma.video.count).toHaveBeenNthCalledWith(1, { where: { ownerId: 'user-1' } });
      expect(prisma.clip.count).toHaveBeenNthCalledWith(1, {
        where: { video: { ownerId: 'user-1' } },
      });
      expect(result).toEqual({
        totalVideos: 5,
        totalClips: 12,
        avgProcessingTimeSeconds: null,
        storageUsedBytes: 3000,
        monthlyVideos: 2,
        monthlyClips: 4,
        premiumCreditsThisMonth: 3,
      });
    });

    it('averages first->last VideoStatusEvent span across terminal videos with at least 2 events', async () => {
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);
      prisma.video.findMany.mockResolvedValue([
        {
          statusEvents: [
            { createdAt: new Date('2026-01-01T00:00:00Z') },
            { createdAt: new Date('2026-01-01T00:01:00Z') },
          ],
        },
        {
          statusEvents: [
            { createdAt: new Date('2026-01-01T00:00:00Z') },
            { createdAt: new Date('2026-01-01T00:03:00Z') },
          ],
        },
        // Only one event - excluded from the average (nothing to span).
        { statusEvents: [{ createdAt: new Date('2026-01-01T00:00:00Z') }] },
      ]);

      const result = await service.getStats('user-1');

      // (60s + 180s) / 2 = 120s
      expect(result.avgProcessingTimeSeconds).toBe(120);
    });

    it('treats a null storage sum as 0, not a fabricated non-zero value', async () => {
      prisma.video.count.mockResolvedValue(0);
      prisma.clip.count.mockResolvedValue(0);

      const result = await service.getStats('user-1');

      expect(result.storageUsedBytes).toBe(0);
    });
  });

  describe('getActivity', () => {
    it('maps ActivityEvent rows to the shared DTO shape, newest first', async () => {
      prisma.activityEvent.findMany.mockResolvedValue([
        {
          id: 'event-1',
          type: 'VIDEO_UPLOADED',
          videoId: 'video-1',
          clipId: null,
          metadata: { title: 'My Video' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getActivity('user-1', 20);

      expect(prisma.activityEvent.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      expect(result).toEqual({
        events: [
          {
            id: 'event-1',
            type: 'VIDEO_UPLOADED',
            videoId: 'video-1',
            clipId: null,
            metadata: { title: 'My Video' },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    });

    it('defaults metadata to null when the row has none', async () => {
      prisma.activityEvent.findMany.mockResolvedValue([
        {
          id: 'event-1',
          type: 'CLIP_EXPORTED',
          videoId: 'video-1',
          clipId: 'clip-1',
          metadata: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getActivity('user-1', 20);

      expect(result.events[0].metadata).toBeNull();
    });

    // Contract Synchronization fix - proves mapActivityEventType (the
    // replacement for the old `as unknown as` cast) round-trips every real
    // Prisma ActivityEventType, including WORKSPACE_DELETED (the value that
    // originally shipped without a matching packages/shared entry and
    // crashed ActivityTimeline). If a future schema.prisma addition isn't
    // wired into mapActivityEventType, the build fails before this test can
    // even run (assertNever) - this test guards the mapping's runtime
    // correctness, not its exhaustiveness, which is a compile-time guarantee.
    it('maps every known Prisma ActivityEventType to its shared DTO counterpart', async () => {
      const rawTypes = [
        'VIDEO_UPLOADED',
        'CLIP_GENERATED',
        'CLIP_EXPORTED',
        'MEMBER_INVITED',
        'WORKSPACE_DELETED',
      ];
      prisma.activityEvent.findMany.mockResolvedValue(
        rawTypes.map((type, i) => ({
          id: `event-${i}`,
          type,
          videoId: null,
          clipId: null,
          metadata: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        })),
      );

      const result = await service.getActivity('user-1', 20);

      expect(result.events.map((e) => e.type)).toEqual(rawTypes);
    });
  });

  describe('exportCsv', () => {
    it('builds a CSV from AnalyticsService overview + 30-day performance data', async () => {
      analytics.getOverview.mockResolvedValue({
        totalVideos: 1,
        totalClips: 2,
        publishedClips: 1,
        averageEngagementScore: 10,
        platformBreakdown: [],
        processingStatus: [],
        uploadTrend: [],
      });
      analytics.getPerformance.mockResolvedValue({
        engagementTrend: [],
        platformComparison: [],
        aiSummary: {
          averageHighlightScore: null,
          averageConfidence: null,
          confidenceDistribution: [],
          topHighlightReasons: [],
          mostCommonSignals: [],
          scoreDistribution: [],
          signalContributions: [],
        },
      });

      const csv = await service.exportCsv('user-1');

      expect(analytics.getOverview).toHaveBeenCalledWith('user-1');
      expect(analytics.getPerformance).toHaveBeenCalledWith('user-1', { days: 30 });
      expect(csv).toContain('Overview,Total Videos,1');
    });
  });
});
