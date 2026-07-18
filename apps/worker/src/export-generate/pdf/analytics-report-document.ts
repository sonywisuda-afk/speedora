import * as React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import type { AnalyticsReportData } from '@speedora/contracts';
import { createSectionBuilders, createStyles, Page } from './sections';

export interface BrandKitForDocument {
  logoUrl: string | null;
  primaryColor: string | null;
}

// The account-wide Analytics Report - a full mirror of the live /analytics
// page's content (Overview + Performance incl. growth summary + AI Summary
// + Top Clips + Top Videos), rendered once as a PDF snapshot fixed to a
// 30-day window. Block builders below stay local to this file (not added
// to sections.ts's shared createSectionBuilders) since, unlike the
// video-report family (PDF/EXCEL/HIGHLIGHT_REPORT/BRAND_REPORT all reusing
// the same 11 sections), only this one document consumes them in V1. Same
// text/table-only convention as every other report document - no chart
// rendering.

function formatPct(pct: number | null): string {
  if (pct === null) return 'n/a';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : String(Math.round(value * 100) / 100);
}

export function buildAnalyticsReportDocument(
  report: AnalyticsReportData,
  brandKit: BrandKitForDocument,
): React.ReactElement {
  const styles = createStyles(brandKit.primaryColor ?? undefined);
  const { kv, heading, subheading, muted, divider } = createSectionBuilders(styles);

  function buildCoverBlock(): React.ReactElement {
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: styles.title }, 'Analytics Report'),
      React.createElement(
        Text,
        { style: styles.subtitle },
        `Speedora Export Center - last ${report.cover.windowDays} days, generated ${report.cover.generatedAt}`,
      ),
      brandKit.logoUrl
        ? React.createElement(Text, { style: styles.muted }, `Brand logo: ${brandKit.logoUrl}`)
        : null,
    );
  }

  function buildOverviewBlock(): React.ReactElement {
    const { overview } = report;
    return React.createElement(
      View,
      null,
      heading('Overview'),
      kv('Total Videos', overview.totalVideos),
      kv('Total Clips', overview.totalClips),
      kv('Published Clips', overview.publishedClips),
      kv('Average Engagement Score', formatMetric(overview.averageEngagementScore)),
      subheading('Platform Breakdown'),
      overview.platformBreakdown.length === 0
        ? muted('No published clips yet.')
        : React.createElement(
            View,
            null,
            ...overview.platformBreakdown.map((entry) => kv(entry.platform, entry.publishedCount)),
          ),
      subheading('Processing Status'),
      overview.processingStatus.length === 0
        ? muted('No videos yet.')
        : React.createElement(
            View,
            null,
            ...overview.processingStatus.map((entry) => kv(entry.status, entry.count)),
          ),
      subheading(`Upload Trend (last ${report.cover.windowDays} days)`),
      React.createElement(
        Text,
        { style: styles.muted },
        `Total uploads: ${overview.uploadTrend.reduce((sum, d) => sum + d.count, 0)}`,
      ),
    );
  }

  function buildGrowthSummaryBlock(): React.ReactElement {
    const { growthSummary } = report.performance;
    const rows: Array<[string, typeof growthSummary.views]> = [
      ['Total Views', growthSummary.views],
      ['Average Engagement', growthSummary.engagementScore],
      ['Total Videos', growthSummary.videos],
      ['Total Clips', growthSummary.clips],
    ];
    return React.createElement(
      View,
      null,
      subheading('Growth Summary (vs. previous period)'),
      ...rows.map(([label, metric]) =>
        kv(
          label,
          `${formatMetric(metric.current)} (${formatMetric(metric.previous)} prev, ${formatPct(metric.growthPct)})`,
        ),
      ),
    );
  }

  function buildPerformanceTrendBlock(): React.ReactElement {
    const { engagementTrend, platformComparison } = report.performance;
    return React.createElement(
      View,
      null,
      heading('Performance Trend'),
      buildGrowthSummaryBlock(),
      subheading('Engagement Trend'),
      React.createElement(
        Text,
        { style: styles.muted },
        `Total publishes: ${engagementTrend.reduce((sum, d) => sum + d.publishCount, 0)}, total views: ${engagementTrend.reduce((sum, d) => sum + d.totalViews, 0)}`,
      ),
      subheading('Platform Comparison'),
      ...platformComparison.map((entry) =>
        kv(
          entry.platform,
          `${entry.publishCount} publishes, avg engagement ${formatMetric(entry.averageEngagementScore)}, ${formatPct(entry.growthPct)}`,
        ),
      ),
    );
  }

  function buildAiSummaryBlock(): React.ReactElement {
    const { aiSummary } = report.performance;
    return React.createElement(
      View,
      null,
      heading('AI Performance Summary'),
      kv('Average Highlight Score', formatMetric(aiSummary.averageHighlightScore)),
      kv('Average Confidence', formatMetric(aiSummary.averageConfidence)),
      subheading('Top Highlight Reasons'),
      aiSummary.topHighlightReasons.length === 0
        ? muted('No highlight reasons yet.')
        : React.createElement(
            View,
            null,
            ...aiSummary.topHighlightReasons.map((entry) =>
              kv(
                `Clip ${entry.clipId}`,
                `${entry.reason} (score: ${formatMetric(entry.highlightScore)})`,
              ),
            ),
          ),
      subheading('Most Common Signals'),
      aiSummary.mostCommonSignals.length === 0
        ? muted('No signals extracted yet.')
        : React.createElement(
            View,
            null,
            ...aiSummary.mostCommonSignals.map((entry) => kv(entry.signal, entry.count)),
          ),
      subheading('Signal Contributions'),
      aiSummary.signalContributions.length === 0
        ? muted('No signal contributions yet.')
        : React.createElement(
            View,
            null,
            ...aiSummary.signalContributions.map((entry) =>
              kv(entry.signal, `${entry.averageContributionPct}% (${entry.clipsWithSignal} clips)`),
            ),
          ),
    );
  }

  function buildTopClipsBlock(): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Top Clips'),
      report.topClips.length === 0
        ? muted('No published clips yet.')
        : React.createElement(
            View,
            null,
            ...report.topClips.map((clip) =>
              kv(
                clip.videoLabel,
                `${clip.platform} - engagement ${formatMetric(clip.engagementScore)}, views ${formatMetric(clip.viewCount)}`,
              ),
            ),
          ),
    );
  }

  function buildTopVideosBlock(): React.ReactElement {
    return React.createElement(
      View,
      null,
      heading('Top Videos'),
      report.topVideos.length === 0
        ? muted('No published videos yet.')
        : React.createElement(
            View,
            null,
            ...report.topVideos.map((video) =>
              kv(
                video.videoLabel,
                `${video.clipCount} clips, avg engagement ${formatMetric(video.averageEngagementScore)}, total views ${video.totalViews}`,
              ),
            ),
          ),
    );
  }

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      buildCoverBlock(),
      divider(),
      buildOverviewBlock(),
      divider(),
      buildPerformanceTrendBlock(),
      divider(),
      buildAiSummaryBlock(),
      divider(),
      buildTopClipsBlock(),
      divider(),
      buildTopVideosBlock(),
    ),
  );
}
