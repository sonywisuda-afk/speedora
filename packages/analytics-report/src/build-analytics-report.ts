import {
  analyticsReportDataSchema,
  buildAnalyticsReportInputSchema,
  type AnalyticsReportData,
  type BuildAnalyticsReportInput,
} from '@speedora/contracts';

// The account-wide Analytics Report's orchestrator - direct analog of
// packages/report-builder's buildVideoReportData. Unlike that package, the
// adapter already shapes each section identically to the live dashboard's
// own endpoints (overview/performance/topClips/topVideos), so this function
// mostly validates the input and assembles the one section unique to the
// PDF: Cover. Pure and synchronous - no external calls, no DB/queue access
// (see this package's own description).
export function buildAnalyticsReportData(input: BuildAnalyticsReportInput): AnalyticsReportData {
  const { generatedAt, windowDays, overview, performance, topClips, topVideos } =
    buildAnalyticsReportInputSchema.parse(input);

  return analyticsReportDataSchema.parse({
    cover: { generatedAt, windowDays },
    overview,
    performance,
    topClips,
    topVideos,
  });
}
