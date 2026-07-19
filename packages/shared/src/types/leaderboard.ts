// Sprint 6D (Analytics Dashboard Expansion - Leaderboard). Workspace-scoped
// per the plan's foundational scoping decision (§1) - ranks Videos/Clips
// belonging to the requesting workspace, regardless of which member
// uploaded each one, never across unrelated workspaces. "Top Creator"
// ranks workspace members by email (User has no `name` field), same
// display convention WorkspaceService.listMembers already uses.
export type LeaderboardMetric = 'views' | 'likes' | 'comments' | 'shares' | 'engagementScore';

// One row, any dimension - `key` is the stable id used for the tie-breaker
// (publishRecordId / userId / campaignId / platform), `label` is display
// text, `value` is the ranked metric (summed for count metrics, averaged
// for engagementScore - see leaderboard.util.ts's metricAggregation()).
// secondaryLabel is optional context (e.g. "12 publikasi") shown alongside
// the bar, not part of the ranking itself.
export interface LeaderboardRow {
  key: string;
  label: string;
  value: number;
  secondaryLabel?: string;
}

export interface WorkspaceLeaderboardDto {
  metric: LeaderboardMetric;
  days: number;
  limit: number;
  topClips: LeaderboardRow[];
  topCreators: LeaderboardRow[];
  topCampaigns: LeaderboardRow[];
  topPlatforms: LeaderboardRow[];
}
