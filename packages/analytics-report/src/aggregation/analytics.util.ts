// Milestone 5A (Analytics Dashboard - Overview) - pure aggregation helpers,
// no Prisma access here (that's AnalyticsService's job - it fetches rows
// and hands them to these functions). Matches the module/adapter test
// split used everywhere else in this codebase (docs/testing.md). Moved from
// apps/api/src/analytics/ into this package so apps/worker (which cannot
// import from apps/api) can reuse the exact same computation for the
// Analytics Report PDF.

export interface EngagementSnapshotRow {
  publishRecordId: string;
  capturedAt: Date;
  engagementScore: number | null;
}

// Same "take the most-recently-captured snapshot per publish record, then
// average" pattern Milestone 1.5's loadUsableSamples() established in
// apps/worker/src/scripts/dataset-lib.ts - reimplemented locally here since
// apps/api can't import from apps/worker. Null (not 0) when no snapshot
// with a non-null engagementScore exists yet - "no data" isn't "zero
// engagement."
export function computeAverageEngagementScore(snapshots: EngagementSnapshotRow[]): number | null {
  const latestByRecord = new Map<string, EngagementSnapshotRow>();
  for (const snapshot of snapshots) {
    const existing = latestByRecord.get(snapshot.publishRecordId);
    if (!existing || snapshot.capturedAt.getTime() > existing.capturedAt.getTime()) {
      latestByRecord.set(snapshot.publishRecordId, snapshot);
    }
  }

  const scores = Array.from(latestByRecord.values())
    .map((s) => s.engagementScore)
    .filter((score): score is number => score !== null);

  if (scores.length === 0) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Zero-filled bucket for the last `days` days (including `now`'s day), so a
// caller can render every bar without checking for gaps. `now` is an
// explicit parameter (defaulting to the real clock) rather than reading
// `new Date()` internally, so this stays a pure, deterministically
// fixture-testable function.
export function bucketUploadsByDay(
  createdAtDates: Date[],
  days: number,
  now: Date = new Date(),
): Array<{ date: string; count: number }> {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(toDateKey(d), 0);
  }

  for (const date of createdAtDates) {
    const key = toDateKey(date);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}
