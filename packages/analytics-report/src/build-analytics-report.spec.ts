import type { BuildAnalyticsReportInput } from '@speedora/contracts';
import { buildAnalyticsReportData } from './build-analytics-report';

function makeInput(overrides: Partial<BuildAnalyticsReportInput> = {}): BuildAnalyticsReportInput {
  return {
    generatedAt: '2026-07-18T00:00:00.000Z',
    windowDays: 30,
    overview: {
      totalVideos: 5,
      totalClips: 12,
      publishedClips: 3,
      averageEngagementScore: 0.42,
      platformBreakdown: [{ platform: 'YOUTUBE', publishedCount: 2 }],
      processingStatus: [{ status: 'DONE', count: 5 }],
      uploadTrend: [{ date: '2026-07-01', count: 1 }],
    },
    performance: {
      growthSummary: {
        views: { current: 150, previous: 100, growthPct: 50 },
        engagementScore: { current: 0.5, previous: 0.4, growthPct: 25 },
        videos: { current: 5, previous: 3, growthPct: 66.7 },
        clips: { current: 12, previous: 10, growthPct: 20 },
      },
      engagementTrend: [
        { date: '2026-07-01', totalViews: 100, averageEngagementScore: 0.4, publishCount: 1 },
      ],
      platformComparison: [
        {
          platform: 'YOUTUBE',
          averageEngagementScore: 0.5,
          averageHighlightScore: 70,
          publishCount: 2,
          growthPct: 10,
        },
      ],
      aiSummary: {
        averageHighlightScore: 65.5,
        averageConfidence: 0.8,
        confidenceDistribution: [{ bucket: '0.8-1.0', count: 3 }],
        topHighlightReasons: [{ clipId: 'clip-1', highlightScore: 90, reason: 'High emotion' }],
        mostCommonSignals: [{ signal: 'audio', count: 5 }],
        scoreDistribution: [{ bucket: '90-100', count: 2 }],
        signalContributions: [{ signal: 'audio', averageContributionPct: 40, clipsWithSignal: 3 }],
      },
    },
    topClips: [
      {
        clipId: 'clip-1',
        publishRecordId: 'pr-1',
        videoId: 'video-1',
        videoLabel: 'My Video',
        thumbnailUrl: null,
        platform: 'YOUTUBE',
        highlightScore: 90,
        engagementScore: 0.5,
        viewCount: 1000,
        likeCount: 50,
        commentCount: 5,
        shareCount: 2,
        publishedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    topVideos: [
      {
        videoId: 'video-1',
        videoLabel: 'My Video',
        clipCount: 3,
        averageHighlightScore: 80,
        averageEngagementScore: 0.45,
        totalViews: 1000,
        totalLikes: 50,
        totalShares: 2,
      },
    ],
    ...overrides,
  };
}

describe('buildAnalyticsReportData', () => {
  it('assembles a Cover section from generatedAt/windowDays and passes every other section through', () => {
    const input = makeInput();
    const result = buildAnalyticsReportData(input);

    expect(result.cover).toEqual({ generatedAt: input.generatedAt, windowDays: input.windowDays });
    expect(result.overview).toEqual(input.overview);
    expect(result.performance).toEqual(input.performance);
    expect(result.topClips).toEqual(input.topClips);
    expect(result.topVideos).toEqual(input.topVideos);
  });

  it('handles an empty account (zero videos/clips, no top clips/videos) without throwing', () => {
    const input = makeInput({
      overview: {
        totalVideos: 0,
        totalClips: 0,
        publishedClips: 0,
        averageEngagementScore: null,
        platformBreakdown: [],
        processingStatus: [],
        uploadTrend: [],
      },
      performance: {
        growthSummary: {
          views: { current: 0, previous: 0, growthPct: null },
          engagementScore: { current: null, previous: null, growthPct: null },
          videos: { current: 0, previous: 0, growthPct: null },
          clips: { current: 0, previous: 0, growthPct: null },
        },
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
      },
      topClips: [],
      topVideos: [],
    });

    const result = buildAnalyticsReportData(input);
    expect(result.overview.totalVideos).toBe(0);
    expect(result.topClips).toEqual([]);
    expect(result.topVideos).toEqual([]);
  });

  it('throws when required input is missing (Zod validation, not a silent pass-through)', () => {
    const input = makeInput();
    // @ts-expect-error deliberately omitting a required field
    delete input.overview;
    expect(() => buildAnalyticsReportData(input)).toThrow();
  });
});
