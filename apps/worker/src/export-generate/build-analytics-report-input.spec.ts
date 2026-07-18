import { buildAnalyticsReportInputFromPrisma } from './build-analytics-report-input';

function fixtureRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pr-1',
    publishedAt: new Date(),
    clip: {
      id: 'clip-1',
      videoId: 'video-1',
      hookText: 'A great hook',
      thumbnailUrl: 'thumbnails/clip-1.webp',
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
    socialAccount: { platform: 'YOUTUBE' },
    statsSnapshots: [
      { viewCount: 100, likeCount: 10, commentCount: 2, shareCount: 1, engagementScore: 0.3 },
    ],
    ...overrides,
  };
}

function makePrisma() {
  return {
    video: { count: jest.fn(), findMany: jest.fn() },
    clip: { count: jest.fn() },
    publishRecordStatsSnapshot: { findMany: jest.fn() },
    publishRecord: { findMany: jest.fn() },
  };
}

describe('buildAnalyticsReportInputFromPrisma', () => {
  it('assembles overview/performance/topClips/topVideos from a fully-populated account', async () => {
    const prisma = makePrisma();
    // video.count call order: totalVideos, currentVideoCount, previousVideoCount
    prisma.video.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    // clip.count call order: totalClips, publishedClips, currentClipCount, previousClipCount
    prisma.clip.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);
    prisma.publishRecordStatsSnapshot.findMany.mockResolvedValue([
      { publishRecordId: 'pr-1', capturedAt: new Date(), engagementScore: 0.4 },
    ]);
    prisma.video.findMany.mockResolvedValue([{ status: 'RENDERED', createdAt: new Date() }]);
    // publishRecord.findMany call order: platformBreakdownRecords, currentRecords, previousRecords
    prisma.publishRecord.findMany
      .mockResolvedValueOnce([{ socialAccount: { platform: 'YOUTUBE' } }])
      .mockResolvedValueOnce([fixtureRecord({ id: 'pr-current' })])
      .mockResolvedValueOnce([fixtureRecord({ id: 'pr-previous' })]);

    const result = await buildAnalyticsReportInputFromPrisma(prisma as never, { userId: 'user-1' });

    expect(result.windowDays).toBe(30);
    expect(result.overview.totalVideos).toBe(5);
    expect(result.overview.totalClips).toBe(12);
    expect(result.overview.publishedClips).toBe(3);
    expect(result.overview.platformBreakdown).toEqual([{ platform: 'YOUTUBE', publishedCount: 1 }]);
    expect(result.overview.processingStatus).toEqual([{ status: 'RENDERED', count: 1 }]);
    expect(result.performance.growthSummary.videos).toEqual({
      current: 2,
      previous: 1,
      growthPct: 100,
    });
    expect(result.performance.growthSummary.clips).toEqual({
      current: 4,
      previous: 2,
      growthPct: 100,
    });
    expect(result.performance.aiSummary.averageHighlightScore).toBe(70);
    expect(result.topClips).toHaveLength(1);
    expect(result.topClips[0].publishRecordId).toBe('pr-current');
    expect(result.topVideos).toHaveLength(1);
    expect(result.topVideos[0].videoId).toBe('video-1');
  });

  it('scopes every query to the requesting user via ownerId', async () => {
    const prisma = makePrisma();
    prisma.video.count.mockResolvedValue(0);
    prisma.clip.count.mockResolvedValue(0);
    prisma.publishRecordStatsSnapshot.findMany.mockResolvedValue([]);
    prisma.video.findMany.mockResolvedValue([]);
    prisma.publishRecord.findMany.mockResolvedValue([]);

    await buildAnalyticsReportInputFromPrisma(prisma as never, { userId: 'user-1' });

    expect(prisma.video.count).toHaveBeenNthCalledWith(1, { where: { ownerId: 'user-1' } });
    expect(prisma.clip.count).toHaveBeenNthCalledWith(1, {
      where: { video: { ownerId: 'user-1' } },
    });
    expect(prisma.publishRecordStatsSnapshot.findMany).toHaveBeenCalledWith({
      where: { publishRecord: { clip: { video: { ownerId: 'user-1' } } } },
      select: { publishRecordId: true, capturedAt: true, engagementScore: true },
    });
    expect(prisma.publishRecord.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'PUBLISHED',
        publishedAt: { gte: expect.any(Date) },
        clip: { video: { ownerId: 'user-1' } },
      },
      select: expect.any(Object),
      take: 500,
    });
  });

  it('handles a fully empty account without throwing - all counts 0, no crash on empty arrays', async () => {
    const prisma = makePrisma();
    prisma.video.count.mockResolvedValue(0);
    prisma.clip.count.mockResolvedValue(0);
    prisma.publishRecordStatsSnapshot.findMany.mockResolvedValue([]);
    prisma.video.findMany.mockResolvedValue([]);
    prisma.publishRecord.findMany.mockResolvedValue([]);

    const result = await buildAnalyticsReportInputFromPrisma(prisma as never, { userId: 'user-1' });

    expect(result.overview.totalVideos).toBe(0);
    expect(result.overview.averageEngagementScore).toBeNull();
    expect(result.performance.growthSummary.views).toEqual({
      current: 0,
      previous: 0,
      growthPct: null,
    });
    expect(result.topClips).toEqual([]);
    expect(result.topVideos).toEqual([]);
  });

  it('reuses currentRecords for topClips/topVideos rather than issuing a third fetch', async () => {
    const prisma = makePrisma();
    prisma.video.count.mockResolvedValue(0);
    prisma.clip.count.mockResolvedValue(0);
    prisma.publishRecordStatsSnapshot.findMany.mockResolvedValue([]);
    prisma.video.findMany.mockResolvedValue([]);
    prisma.publishRecord.findMany
      .mockResolvedValueOnce([]) // platformBreakdownRecords
      .mockResolvedValueOnce([
        fixtureRecord({ id: 'pr-low', statsSnapshots: [{ viewCount: 10, engagementScore: 0.1 }] }),
        fixtureRecord({
          id: 'pr-high',
          statsSnapshots: [{ viewCount: 500, engagementScore: 0.9 }],
        }),
      ]) // currentRecords
      .mockResolvedValueOnce([]); // previousRecords

    const result = await buildAnalyticsReportInputFromPrisma(prisma as never, { userId: 'user-1' });

    // Exactly 3 publishRecord.findMany calls total - platform breakdown +
    // current + previous, no extra fetch for topClips/topVideos.
    expect(prisma.publishRecord.findMany).toHaveBeenCalledTimes(3);
    expect(result.topClips.map((c) => c.publishRecordId)).toEqual(['pr-high', 'pr-low']);
  });
});
