import type { SocialPlatform } from './social';
import type { VideoStatus } from './video';

// Milestone 5A (Analytics Dashboard - Overview) - aggregated, per-user data
// over already-stored Video/Clip/PublishRecord/PublishRecordStatsSnapshot
// rows (Milestone 1). No AI-signal-specific fields here - that's Milestone
// 5C's concern (highlight score/confidence distributions, signal
// contributions), not this stage's.
export interface AnalyticsOverviewDto {
  totalVideos: number;
  totalClips: number;
  // Distinct clips with at least one PUBLISHED PublishRecord.
  publishedClips: number;
  // Mean of the latest PublishRecordStatsSnapshot.engagementScore per
  // publish record, across every publish record this user owns. Null (not
  // 0) when no snapshot with a non-null engagementScore exists yet - "no
  // data" is not "zero engagement."
  averageEngagementScore: number | null;
  platformBreakdown: Array<{ platform: SocialPlatform; publishedCount: number }>;
  processingStatus: Array<{ status: VideoStatus; count: number }>;
  // Last 30 days, zero-filled for days with no uploads - a caller can
  // render every bar without checking for gaps.
  uploadTrend: Array<{ date: string; count: number }>;
}

// Milestone 5B (Analytics Dashboard - Performance) - one row per
// PublishRecord, not per Clip: platform/views/likes/comments/shares/publish
// date are all properties of "a clip published to one platform," not of the
// clip itself (the same clip published to two platforms has two different
// stat sets).
export interface TopClipRow {
  clipId: string;
  publishRecordId: string;
  videoId: string;
  // clip.hookText, falling back to a generic label - Video has no `title`
  // field, same fallback every existing UI (ClipCard, VideoAnalysisDashboard)
  // already uses.
  videoLabel: string;
  // Product Experience roadmap - already a `/clips/:id/thumbnail` relative
  // endpoint path, never the raw storage key (same treatment as Clip's own
  // thumbnailUrl in packages/shared/src/types/video.ts). Null until the
  // clip's render-clip.worker.ts extraction succeeds.
  thumbnailUrl: string | null;
  platform: SocialPlatform;
  highlightScore: number | null;
  engagementScore: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  publishedAt: string | null;
}

export interface TopVideoRow {
  videoId: string;
  videoLabel: string;
  clipCount: number;
  averageHighlightScore: number | null;
  averageEngagementScore: number | null;
  totalViews: number;
  totalLikes: number;
  totalShares: number;
}

// Bucketed by publish date, not snapshot-capture date - `publishCount` only
// makes sense as "how many clips went live this day," so `totalViews`/
// `averageEngagementScore` per day are the latest-known stats for whatever
// was published that day, not a growing view-count-over-time series.
export interface EngagementTrendPoint {
  date: string;
  totalViews: number;
  averageEngagementScore: number | null;
  publishCount: number;
}

export interface PlatformComparisonRow {
  platform: SocialPlatform;
  averageEngagementScore: number | null;
  averageHighlightScore: number | null;
  publishCount: number;
  // Percent change in publishCount vs. the immediately preceding window of
  // equal length. Null (not a fabricated 0%/±∞%) when there's no prior-period
  // data to compare against.
  growthPct: number | null;
}

// Shared bucket shape - a labeled range + how many items fall in it. Used
// for both highlight-score and confidence histograms (Milestone 5C-A/5C-B),
// and by /ops/ai/distribution's per-feature histograms.
export interface HistogramBucket {
  bucket: string;
  count: number;
}

// Milestone 5C-A - a signal's share of the total weightedContribution mass
// across the clips in scope (owner-scoped here; system-wide in
// /ops/ai/signals - same shape, different candidate set). Uses
// weightedContribution, not normalizedValue, so it answers "what's actually
// moving highlightScore today" - most signals read ~0% since they're still
// weight 0 pending calibration (packages/fusion-engine/src/weights.ts),
// which is itself the correct, honest signal.
export interface SignalContributionEntry {
  signal: string;
  averageContributionPct: number;
  clipsWithSignal: number;
}

export interface AiPerformanceSummary {
  averageHighlightScore: number | null;
  averageConfidence: number | null;
  confidenceDistribution: HistogramBucket[];
  // The highlightReason text of the top N highest-highlightScore clips in
  // the window - not a frequency count. highlightReason is a free-text
  // sentence per clip, so "most common reason" isn't a meaningful aggregate
  // the way "most common signal" (below) is.
  topHighlightReasons: Array<{ clipId: string; highlightScore: number | null; reason: string }>;
  // A real frequency count - across the window's clips, how often each
  // signal appears in that clip's highlightExplainability.topFactors.
  mostCommonSignals: Array<{ signal: string; count: number }>;
  // Milestone 5C-A additions - Highlight Score Distribution (10 buckets of
  // 10 pts) and per-signal Contribution %, both scoped to this user's own
  // clips in the window (contrast with /ops/ai/signals + /ops/ai/distribution,
  // which pool every user's clips for statistical power).
  scoreDistribution: HistogramBucket[];
  signalContributions: SignalContributionEntry[];
}

export interface AnalyticsPerformanceDto {
  engagementTrend: EngagementTrendPoint[];
  platformComparison: PlatformComparisonRow[];
  aiSummary: AiPerformanceSummary;
}

export interface AnalyticsPerformanceClipsDto {
  clips: TopClipRow[];
}

export interface AnalyticsPerformanceVideosDto {
  videos: TopVideoRow[];
}
