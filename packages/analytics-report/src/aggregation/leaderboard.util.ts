import type { LeaderboardMetric, LeaderboardRow, SocialPlatform } from '@speedora/shared';

// Sprint 6D (Leaderboard) - pure aggregation, no Prisma access, same
// module/adapter split as every other file in this package. One
// already-fetched candidate list feeds all 4 dimensions (Top Clip/Creator/
// Campaign/Platform) - a single query on the API side, not 4.

export interface LeaderboardCandidate {
  publishRecordId: string;
  videoLabel: string;
  platform: SocialPlatform;
  ownerId: string;
  ownerEmail: string;
  campaignId: string | null;
  campaignName: string | null;
  // The latest in-window snapshot's raw metrics - extractMetric() below
  // picks the one field the caller asked to rank by.
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  engagementScore: number | null;
}

export function extractMetric(
  candidate: LeaderboardCandidate,
  metric: LeaderboardMetric,
): number | null {
  switch (metric) {
    case 'views':
      return candidate.viewCount;
    case 'likes':
      return candidate.likeCount;
    case 'comments':
      return candidate.commentCount;
    case 'shares':
      return candidate.shareCount;
    case 'engagementScore':
      return candidate.engagementScore;
  }
}

// engagementScore is a ratio, not a count - summing it across a creator's/
// campaign's/platform's records would produce a meaningless number that
// grows with publish volume alone. Every other metric is a real count, so
// summing is the honest "total reach" aggregate. Same distinction
// AnalyticsService's platformComparison already draws (average() for
// engagementScore, plain counts elsewhere).
function metricAggregation(metric: LeaderboardMetric): 'sum' | 'average' {
  return metric === 'engagementScore' ? 'average' : 'sum';
}

interface RankableRow {
  key: string;
  label: string;
  value: number | null;
  secondaryLabel?: string;
}

// Deterministic ranking: value descending, then key ascending as an
// explicit tie-breaker - never relies on input order or a sort's stability
// alone, so the same underlying data always produces the same order
// regardless of how the candidates were fetched/grouped.
function toRankedRows(rows: RankableRow[], limit: number): LeaderboardRow[] {
  return rows
    .filter((row): row is RankableRow & { value: number } => row.value !== null)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((row) => ({
      key: row.key,
      label: row.label,
      value: row.value,
      secondaryLabel: row.secondaryLabel,
    }));
}

// Top Clip - one row per PublishRecord, unaggregated (a clip published to
// 2 platforms is 2 separate rows, same "one row per publish attempt"
// convention as TopClipRow elsewhere in this app).
export function computeTopClips(
  candidates: LeaderboardCandidate[],
  metric: LeaderboardMetric,
  limit: number,
): LeaderboardRow[] {
  return toRankedRows(
    candidates.map((c) => ({
      key: c.publishRecordId,
      label: c.videoLabel,
      value: extractMetric(c, metric),
    })),
    limit,
  );
}

interface GroupAccumulator {
  label: string;
  values: number[];
  recordCount: number;
}

function groupBy(
  candidates: LeaderboardCandidate[],
  metric: LeaderboardMetric,
  groupOf: (c: LeaderboardCandidate) => { key: string; label: string } | null,
): Map<string, GroupAccumulator> {
  const groups = new Map<string, GroupAccumulator>();
  for (const candidate of candidates) {
    const group = groupOf(candidate);
    const value = extractMetric(candidate, metric);
    if (group === null || value === null) continue;
    const acc = groups.get(group.key) ?? { label: group.label, values: [], recordCount: 0 };
    acc.values.push(value);
    acc.recordCount += 1;
    groups.set(group.key, acc);
  }
  return groups;
}

function groupsToRows(
  groups: Map<string, GroupAccumulator>,
  metric: LeaderboardMetric,
  limit: number,
): LeaderboardRow[] {
  const aggregation = metricAggregation(metric);
  const rows: RankableRow[] = Array.from(groups.entries()).map(([key, acc]) => ({
    key,
    label: acc.label,
    value:
      aggregation === 'sum'
        ? acc.values.reduce((sum, v) => sum + v, 0)
        : acc.values.reduce((sum, v) => sum + v, 0) / acc.values.length,
    secondaryLabel: `${acc.recordCount} publikasi`,
  }));
  return toRankedRows(rows, limit);
}

// Top Creator - ranks workspace members by email (User has no `name`
// field), aggregated across every publish record they own in-window.
export function computeTopCreators(
  candidates: LeaderboardCandidate[],
  metric: LeaderboardMetric,
  limit: number,
): LeaderboardRow[] {
  const groups = groupBy(candidates, metric, (c) => ({ key: c.ownerId, label: c.ownerEmail }));
  return groupsToRows(groups, metric, limit);
}

// Top Campaign - excludes records with no campaignId (most publishes have
// none - "not in any campaign" isn't a meaningful leaderboard entry).
export function computeTopCampaigns(
  candidates: LeaderboardCandidate[],
  metric: LeaderboardMetric,
  limit: number,
): LeaderboardRow[] {
  const groups = groupBy(candidates, metric, (c) =>
    c.campaignId === null ? null : { key: c.campaignId, label: c.campaignName ?? c.campaignId },
  );
  return groupsToRows(groups, metric, limit);
}

// Top Platform - all 8 supported platforms are real candidates (Sprint 6A
// fixed the analogous hardcoded-3-platform bug in AnalyticsService; this is
// a fresh implementation so it never inherits that bug). Only platforms
// with at least one in-window record appear - unlike platformComparison,
// this is a ranked leaderboard, not a fixed comparison table, so a
// zero-data platform has nothing to rank.
export function computeTopPlatforms(
  candidates: LeaderboardCandidate[],
  metric: LeaderboardMetric,
  limit: number,
): LeaderboardRow[] {
  const groups = groupBy(candidates, metric, (c) => ({ key: c.platform, label: c.platform }));
  return groupsToRows(groups, metric, limit);
}

export interface LeaderboardResult {
  topClips: LeaderboardRow[];
  topCreators: LeaderboardRow[];
  topCampaigns: LeaderboardRow[];
  topPlatforms: LeaderboardRow[];
}

// The one entry point AnalyticsWorkspaceService calls - fetches candidates
// once, computes all 4 dimensions from that single list.
export function computeLeaderboard(
  candidates: LeaderboardCandidate[],
  metric: LeaderboardMetric,
  limit: number,
): LeaderboardResult {
  return {
    topClips: computeTopClips(candidates, metric, limit),
    topCreators: computeTopCreators(candidates, metric, limit),
    topCampaigns: computeTopCampaigns(candidates, metric, limit),
    topPlatforms: computeTopPlatforms(candidates, metric, limit),
  };
}
