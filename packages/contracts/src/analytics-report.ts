import { z } from 'zod';

// Analytics Report (account-wide Export Center report type) - packages/analytics-report's
// whole input/output contract. Every leaf schema below mirrors an existing
// packages/shared analytics shape rather than importing it, same reasoning
// export-center.ts documents: a DB-agnostic contract package never depends
// on the DB-facing packages/shared, even though the two describe the same
// data by convention.

const platformBreakdownEntrySchema = z.object({
  platform: z.string(),
  publishedCount: z.number(),
});

const processingStatusEntrySchema = z.object({
  status: z.string(),
  count: z.number(),
});

const uploadTrendPointSchema = z.object({
  date: z.string(),
  count: z.number(),
});

// Mirrors AnalyticsOverviewDto.
const overviewSectionSchema = z.object({
  totalVideos: z.number(),
  totalClips: z.number(),
  publishedClips: z.number(),
  averageEngagementScore: z.number().nullable(),
  platformBreakdown: z.array(platformBreakdownEntrySchema),
  processingStatus: z.array(processingStatusEntrySchema),
  uploadTrend: z.array(uploadTrendPointSchema),
});

// Mirrors GrowthMetric/GrowthSummary.
const growthMetricSchema = z.object({
  current: z.number().nullable(),
  previous: z.number().nullable(),
  growthPct: z.number().nullable(),
});

const growthSummarySchema = z.object({
  views: growthMetricSchema,
  engagementScore: growthMetricSchema,
  videos: growthMetricSchema,
  clips: growthMetricSchema,
});

const engagementTrendPointSchema = z.object({
  date: z.string(),
  totalViews: z.number(),
  averageEngagementScore: z.number().nullable(),
  publishCount: z.number(),
});

const platformComparisonRowSchema = z.object({
  platform: z.string(),
  averageEngagementScore: z.number().nullable(),
  averageHighlightScore: z.number().nullable(),
  publishCount: z.number(),
  growthPct: z.number().nullable(),
});

const histogramBucketSchema = z.object({ bucket: z.string(), count: z.number() });

const signalContributionEntrySchema = z.object({
  signal: z.string(),
  averageContributionPct: z.number(),
  clipsWithSignal: z.number(),
});

// Mirrors AiPerformanceSummary.
const aiSummarySchema = z.object({
  averageHighlightScore: z.number().nullable(),
  averageConfidence: z.number().nullable(),
  confidenceDistribution: z.array(histogramBucketSchema),
  topHighlightReasons: z.array(
    z.object({
      clipId: z.string(),
      highlightScore: z.number().nullable(),
      reason: z.string(),
    }),
  ),
  mostCommonSignals: z.array(z.object({ signal: z.string(), count: z.number() })),
  scoreDistribution: z.array(histogramBucketSchema),
  signalContributions: z.array(signalContributionEntrySchema),
});

// Mirrors AnalyticsPerformanceDto.
const performanceSectionSchema = z.object({
  growthSummary: growthSummarySchema,
  engagementTrend: z.array(engagementTrendPointSchema),
  platformComparison: z.array(platformComparisonRowSchema),
  aiSummary: aiSummarySchema,
});

// Mirrors TopClipRow.
const topClipRowSchema = z.object({
  clipId: z.string(),
  publishRecordId: z.string(),
  videoId: z.string(),
  videoLabel: z.string(),
  thumbnailUrl: z.string().nullable(),
  platform: z.string(),
  highlightScore: z.number().nullable(),
  engagementScore: z.number().nullable(),
  viewCount: z.number().nullable(),
  likeCount: z.number().nullable(),
  commentCount: z.number().nullable(),
  shareCount: z.number().nullable(),
  publishedAt: z.string().nullable(),
});

// Mirrors TopVideoRow.
const topVideoRowSchema = z.object({
  videoId: z.string(),
  videoLabel: z.string(),
  clipCount: z.number(),
  averageHighlightScore: z.number().nullable(),
  averageEngagementScore: z.number().nullable(),
  totalViews: z.number(),
  totalLikes: z.number(),
  totalShares: z.number(),
});

// ---- input: already-fetched, narrowed, account-wide data - the adapter
// (apps/worker's build-analytics-report-input.ts) re-implements the same
// Prisma queries AnalyticsService.getOverview/getPerformance/
// getPerformanceClips/getPerformanceVideos already run, scoped by userId
// instead of the live dashboard's request-scoped auth. ----

export const buildAnalyticsReportInputSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number(),
  overview: overviewSectionSchema,
  performance: performanceSectionSchema,
  topClips: z.array(topClipRowSchema),
  topVideos: z.array(topVideoRowSchema),
});

// ---- output: a near-identical pass-through of the input, plus a Cover
// section - unlike video-report's per-clip section derivation, this report
// is already shaped by the adapter (it re-runs the same queries the live
// dashboard uses, one section at a time), so the orchestrator's job is
// mostly validation, not further section-building. ----

const coverSectionSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number(),
});

export const analyticsReportDataSchema = z.object({
  cover: coverSectionSchema,
  overview: overviewSectionSchema,
  performance: performanceSectionSchema,
  topClips: z.array(topClipRowSchema),
  topVideos: z.array(topVideoRowSchema),
});

export type BuildAnalyticsReportInput = z.infer<typeof buildAnalyticsReportInputSchema>;
export type AnalyticsReportData = z.infer<typeof analyticsReportDataSchema>;
export type AnalyticsReportCoverSection = z.infer<typeof coverSectionSchema>;
export type AnalyticsReportOverviewSection = z.infer<typeof overviewSectionSchema>;
export type AnalyticsReportPerformanceSection = z.infer<typeof performanceSectionSchema>;
export type AnalyticsReportGrowthSummary = z.infer<typeof growthSummarySchema>;
export type AnalyticsReportTopClip = z.infer<typeof topClipRowSchema>;
export type AnalyticsReportTopVideo = z.infer<typeof topVideoRowSchema>;
