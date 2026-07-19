import type { UnavailableSection } from './unavailable';

// Sprint 6H (Heatmap). Real data: which day-of-week/hour this account's (or
// workspace's) clips tend to publish into higher engagement - derived from
// PublishRecord.publishedAt x its latest stats snapshot, the same source
// every other engagement number in this app reads. This is a
// publish-time-vs-engagement heatmap, explicitly NOT a video-scrubber
// audience-retention curve - no platform this app integrates with exposes
// that (see AnalyticsHeatmapDto's retention/dropOff/replay fields below).
//
// dayOfWeek follows Date.getUTCDay()'s convention (0=Sunday..6=Saturday),
// same as RecurringSchedule's own daysOfWeek. Bucketed in UTC, not each
// creator's own local time - PublishRecord has no per-record timezone to
// convert with (unlike RecurringSchedule, which stores one explicitly) -
// the frontend labels this honestly as UTC rather than implying local time.
export interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  publishCount: number;
  totalViews: number;
  // Null (not 0) when no publish in this cell has a non-null
  // engagementScore yet - same "no data is not zero" convention as
  // AnalyticsOverviewDto.averageEngagementScore.
  averageEngagementScore: number | null;
}

export interface AnalyticsHeatmapDto {
  // Always all 168 (7 x 24) cells, zero-filled - a caller can render every
  // cell without checking for gaps.
  cells: HeatmapCell[];
  // Second-by-second video watch-through - no platform this app integrates
  // with exposes this without the deferred YouTube Analytics API scope.
  retention: UnavailableSection;
  // Derived from a retention curve, so it inherits the same hard gap.
  dropOff: UnavailableSection;
  // No platform in this app's current API surface exposes a replay/rewatch
  // count at all, not even Instagram.
  replay: UnavailableSection;
}
