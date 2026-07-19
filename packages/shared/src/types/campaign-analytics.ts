import type { CampaignStatus } from './campaign';
import type { EngagementTrendPoint, TrendGranularity } from './analytics';
import type { SocialPlatform } from './social';

// Sprint 6E (Campaign-level analytics rollup). Scoped to one campaign's own
// PUBLISHED PublishRecords - never a cross-campaign aggregate (that's
// Sprint 6D's Leaderboard Top Campaign dimension). Every number here reads
// PublishRecordStatsSnapshot the same way AnalyticsService/
// WorkspaceAnalyticsService already do - never recomputed differently.
export interface CampaignPlatformBreakdownRow {
  platform: SocialPlatform;
  publishCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  // Null (not 0) when no PUBLISHED record on this platform has a
  // non-null engagementScore yet - same "no data is not zero" convention
  // as AnalyticsOverviewDto.averageEngagementScore.
  averageEngagementScore: number | null;
}

export interface CampaignAnalyticsTotals {
  publishCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  averageEngagementScore: number | null;
}

export interface CampaignAnalyticsDto {
  campaignId: string;
  // Informational only - CampaignStatus (DRAFT/SCHEDULED/RUNNING/COMPLETED/
  // CANCELLED) never filters or changes any number below. A CANCELLED or
  // still-RUNNING campaign reports the same kind of real numbers, just for
  // however many jobs have actually published so far - only
  // PublishRecord.status === PUBLISHED gates what's included.
  status: CampaignStatus;
  totals: CampaignAnalyticsTotals;
  platformBreakdown: CampaignPlatformBreakdownRow[];
  engagementTrend: EngagementTrendPoint[];
  granularity: TrendGranularity;
  // Sprint 6K (Conversion) - null means "no TrackedLink created for this
  // campaign yet" (not zero clicks). Kept as its own top-level field, not
  // folded into `totals`, since Conversion is a deliberately different KPI
  // category from the synced engagement metrics in `totals` - see the
  // project's Revenue/Conversion governing decisions. Summed across every
  // TrackedLink attached to this campaign, bot-filtered.
  conversionCount: number | null;
}
