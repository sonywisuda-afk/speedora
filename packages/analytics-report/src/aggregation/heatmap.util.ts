import type { HeatmapCell, UnavailableSection } from '@speedora/shared';

// Sprint 6H (Heatmap) - pure aggregation, no Prisma access, same
// module/adapter split as every other file in this package.

// Single source of truth for these 3 reasons - both AnalyticsService
// (owner-scoped) and WorkspaceAnalyticsService (workspace-scoped) return
// the exact same explanation rather than two independently-hand-typed
// copies that could drift.
export const RETENTION_UNAVAILABLE: UnavailableSection = {
  available: false,
  reason:
    'No connected platform exposes a second-by-second watch-through curve without the deferred YouTube Analytics API scope.',
};
export const DROP_OFF_UNAVAILABLE: UnavailableSection = {
  available: false,
  reason: 'Derived from a retention curve, which no connected platform exposes today.',
};
export const REPLAY_UNAVAILABLE: UnavailableSection = {
  available: false,
  reason: 'No connected platform exposes a replay/rewatch count today.',
};

export interface HeatmapRecord {
  publishedAt: Date;
  viewCount: number | null;
  engagementScore: number | null;
}

const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;

function cellKey(dayOfWeek: number, hour: number): string {
  return `${dayOfWeek}-${hour}`;
}

// Zero-filled - all 168 (day x hour) cells are always present, even with
// zero publishes in most of them, so a caller can render every cell
// without checking for gaps. UTC-bucketed (getUTCDay()/getUTCHours()) - see
// HeatmapCell's own doc comment for why this can't be each creator's local
// time.
export function computePublishTimeHeatmap(records: HeatmapRecord[]): HeatmapCell[] {
  const cells = new Map<
    string,
    { publishCount: number; totalViews: number; engagementScores: number[] }
  >();
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      cells.set(cellKey(day, hour), { publishCount: 0, totalViews: 0, engagementScores: [] });
    }
  }

  for (const record of records) {
    const cell = cells.get(cellKey(record.publishedAt.getUTCDay(), record.publishedAt.getUTCHours()));
    if (!cell) continue;
    cell.publishCount += 1;
    cell.totalViews += record.viewCount ?? 0;
    if (record.engagementScore !== null) cell.engagementScores.push(record.engagementScore);
  }

  const result: HeatmapCell[] = [];
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      const cell = cells.get(cellKey(day, hour))!;
      result.push({
        dayOfWeek: day,
        hour,
        publishCount: cell.publishCount,
        totalViews: cell.totalViews,
        averageEngagementScore:
          cell.engagementScores.length === 0
            ? null
            : cell.engagementScores.reduce((sum, v) => sum + v, 0) / cell.engagementScores.length,
      });
    }
  }
  return result;
}
