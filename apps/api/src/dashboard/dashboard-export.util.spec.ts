import type { AnalyticsOverviewDto, AnalyticsPerformanceDto } from '@speedora/shared';
import { buildDashboardReportCsv } from './dashboard-export.util';

const overview: AnalyticsOverviewDto = {
  totalVideos: 5,
  totalClips: 12,
  publishedClips: 3,
  averageEngagementScore: 42.345,
  platformBreakdown: [{ platform: 'YOUTUBE' as never, publishedCount: 2 }],
  processingStatus: [],
  uploadTrend: [],
};

const performance: AnalyticsPerformanceDto = {
  engagementTrend: [],
  platformComparison: [
    {
      platform: 'YOUTUBE' as never,
      averageEngagementScore: 50,
      averageHighlightScore: 70,
      publishCount: 2,
      growthPct: 10,
    },
  ],
  aiSummary: {
    averageHighlightScore: 65.5,
    averageConfidence: 0.8,
    confidenceDistribution: [],
    topHighlightReasons: [],
    mostCommonSignals: [],
    scoreDistribution: [],
    signalContributions: [],
  },
  growthSummary: {
    views: { current: 100, previous: 80, growthPct: 25 },
    engagementScore: { current: 50, previous: 40, growthPct: 25 },
    videos: { current: 5, previous: 3, growthPct: 66.7 },
    clips: { current: 12, previous: 10, growthPct: 20 },
  },
};

describe('buildDashboardReportCsv', () => {
  it('includes an Overview section with the headline numbers', () => {
    const csv = buildDashboardReportCsv(overview, performance);

    expect(csv).toContain('Overview,Total Videos,5');
    expect(csv).toContain('Overview,Total Clips,12');
    expect(csv).toContain('Overview,Published Clips,3');
    expect(csv).toContain('Overview,Average Engagement Score,42.345');
  });

  it('includes one Platform Breakdown row per platform', () => {
    const csv = buildDashboardReportCsv(overview, performance);

    expect(csv).toContain('Platform Breakdown,YOUTUBE,2');
  });

  it('includes the 30-day performance summary', () => {
    const csv = buildDashboardReportCsv(overview, performance);

    expect(csv).toContain('Performance (last 30 days),Average Highlight Score,65.5');
    expect(csv).toContain('Performance (last 30 days),Average Confidence,0.8');
  });

  it('falls back to "n/a" for null averages rather than an empty/misleading value', () => {
    const csv = buildDashboardReportCsv(
      { ...overview, averageEngagementScore: null },
      {
        ...performance,
        aiSummary: {
          ...performance.aiSummary,
          averageHighlightScore: null,
          averageConfidence: null,
        },
      },
    );

    expect(csv).toContain('Overview,Average Engagement Score,n/a');
    expect(csv).toContain('Performance (last 30 days),Average Highlight Score,n/a');
    expect(csv).toContain('Performance (last 30 days),Average Confidence,n/a');
  });

  it('quotes a field that contains a comma (e.g. the platform-performance summary sentence)', () => {
    const csv = buildDashboardReportCsv(overview, performance);

    expect(csv).toContain('"2 published, avg engagement 50"');
  });
});
