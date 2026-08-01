import type { AnalyticsService } from '../analytics/analytics.service';
import type { ExportService } from '../export/export.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    video: { count: jest.Mock; findMany: jest.Mock; aggregate: jest.Mock };
    clip: { count: jest.Mock; aggregate: jest.Mock };
    premiumCredit: { count: jest.Mock };
    activityEvent: { findMany: jest.Mock };
    exportJob: { findMany: jest.Mock; groupBy: jest.Mock; findFirst: jest.Mock };
  };
  let analytics: { getOverview: jest.Mock; getPerformance: jest.Mock };
  let exportService: { toDto: jest.Mock };

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
      exportJob: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    analytics = { getOverview: jest.fn(), getPerformance: jest.fn() };
    // toDto is ExportService's real (non-trivial) mapping in production -
    // stubbed here as an identity-ish pass-through since getExports()'s own
    // tests only care that it's called per recent job, not re-verifying
    // ExportService's own toDto behavior (already covered by
    // export.service.spec.ts).
    exportService = { toDto: jest.fn((job) => job) };
    service = new DashboardService(
      prisma as unknown as PrismaService,
      analytics as unknown as AnalyticsService,
      exportService as unknown as ExportService,
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

  // Phase E (Dashboard & Recent Activity) - Export Center visibility.
  describe('getExports', () => {
    it('folds groupBy status/type rows into counts, zero-filling every ExportType member', async () => {
      prisma.exportJob.findMany.mockResolvedValue([]);
      prisma.exportJob.groupBy.mockResolvedValueOnce([
        { status: 'PENDING', _count: { _all: 2 } },
        { status: 'PROCESSING', _count: { _all: 1 } },
        { status: 'READY', _count: { _all: 5 } },
        { status: 'FAILED', _count: { _all: 3 } },
      ]);
      prisma.exportJob.groupBy.mockResolvedValueOnce([
        { type: 'PDF', _count: { _all: 4 } },
        { type: 'PPTX', _count: { _all: 2 } },
      ]);
      prisma.exportJob.findFirst.mockResolvedValue({
        updatedAt: new Date('2026-08-01T12:00:00Z'),
      });

      const result = await service.getExports('user-1');

      expect(prisma.exportJob.groupBy).toHaveBeenNthCalledWith(1, {
        by: ['status'],
        where: { userId: 'user-1' },
        _count: { _all: true },
      });
      expect(prisma.exportJob.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'READY' },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      });
      expect(result.pendingCount).toBe(2);
      expect(result.processingCount).toBe(1);
      expect(result.readyCount).toBe(5);
      expect(result.failedCount).toBe(3);
      expect(result.totalExports).toBe(11);
      expect(result.successRate).toBeCloseTo(5 / 8);
      expect(result.lastReadyAt).toBe('2026-08-01T12:00:00.000Z');
      expect(result.exportsByType).toEqual({
        PDF: 4,
        EXCEL: 0,
        HIGHLIGHT_REPORT: 0,
        BRAND_REPORT: 0,
        ANALYTICS_REPORT: 0,
        PPTX: 2,
      });
    });

    it('reports successRate/lastReadyAt as null when no job has ever reached a terminal status', async () => {
      prisma.exportJob.findMany.mockResolvedValue([]);
      prisma.exportJob.groupBy.mockResolvedValueOnce([
        { status: 'PENDING', _count: { _all: 1 } },
      ]);
      prisma.exportJob.groupBy.mockResolvedValueOnce([]);
      prisma.exportJob.findFirst.mockResolvedValue(null);

      const result = await service.getExports('user-1');

      expect(result.successRate).toBeNull();
      expect(result.lastReadyAt).toBeNull();
      expect(result.totalExports).toBe(1);
    });

    it('maps recent jobs through ExportService.toDto rather than re-deriving the DTO shape itself', async () => {
      const job = { id: 'job-1', userId: 'user-1', status: 'READY' };
      prisma.exportJob.findMany.mockResolvedValue([job]);
      prisma.exportJob.groupBy.mockResolvedValue([]);
      prisma.exportJob.findFirst.mockResolvedValue(null);

      const result = await service.getExports('user-1');

      expect(prisma.exportJob.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      expect(exportService.toDto).toHaveBeenCalledWith(job);
      expect(result.recentExports).toEqual([job]);
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
