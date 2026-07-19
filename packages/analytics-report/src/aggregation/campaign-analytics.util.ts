import type {
  CampaignAnalyticsTotals,
  CampaignPlatformBreakdownRow,
  SocialPlatform,
} from '@speedora/shared';

// Sprint 6E (Campaign-level analytics rollup) - pure aggregation, no Prisma
// access, same module/adapter split as every other file in this package.
// The caller passes only PUBLISHED PublishRecords (the only status with
// real PublishRecordStatsSnapshot data) - campaign status
// (DRAFT/RUNNING/COMPLETED/CANCELLED/...) is never a parameter here and
// never filters anything in this file; see CampaignAnalyticsDto's own
// comment for why.
export interface CampaignAnalyticsRecord {
  platform: SocialPlatform;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  engagementScore: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Handles an empty array the same as any non-empty one - a campaign with no
// PUBLISHED jobs yet (or none at all) gets real zeros/nulls back, never an
// exception. Same "no data is not zero" convention as
// AnalyticsOverviewDto.averageEngagementScore.
export function computeCampaignTotals(
  records: CampaignAnalyticsRecord[],
): CampaignAnalyticsTotals {
  const engagementScores = records
    .map((r) => r.engagementScore)
    .filter((v): v is number => v !== null);

  return {
    publishCount: records.length,
    totalViews: records.reduce((sum, r) => sum + (r.viewCount ?? 0), 0),
    totalLikes: records.reduce((sum, r) => sum + (r.likeCount ?? 0), 0),
    totalComments: records.reduce((sum, r) => sum + (r.commentCount ?? 0), 0),
    totalShares: records.reduce((sum, r) => sum + (r.shareCount ?? 0), 0),
    averageEngagementScore: average(engagementScores),
  };
}

export function computeCampaignPlatformBreakdown(
  records: CampaignAnalyticsRecord[],
): CampaignPlatformBreakdownRow[] {
  const byPlatform = new Map<SocialPlatform, CampaignAnalyticsRecord[]>();
  for (const record of records) {
    const group = byPlatform.get(record.platform) ?? [];
    group.push(record);
    byPlatform.set(record.platform, group);
  }

  return Array.from(byPlatform.entries()).map(([platform, group]) => ({
    platform,
    ...computeCampaignTotals(group),
  }));
}
