import type { EngagementTrendPoint, GrowthSummary, TrendGranularity } from '@speedora/shared';

// Milestone 5B (Analytics Dashboard - Performance) - pure aggregation
// helpers, no Prisma access here, same module/adapter split as
// analytics.util.ts. Moved from apps/api/src/analytics/ into this package
// so apps/worker (which cannot import from apps/api) can reuse the exact
// same computation for the Analytics Report PDF.

const CONFIDENCE_BUCKET_LABELS = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'];

// 5 fixed-width buckets over [0, 1]. Clamped defensively (same posture as
// analytics.util.ts/lib/explainability.ts's other [0,1] clamps) against a
// confidence value outside its documented range.
export function computeConfidenceDistribution(
  confidences: number[],
): Array<{ bucket: string; count: number }> {
  const counts = new Array(CONFIDENCE_BUCKET_LABELS.length).fill(0) as number[];
  for (const confidence of confidences) {
    const clamped = Math.min(1, Math.max(0, confidence));
    const index = clamped === 1 ? counts.length - 1 : Math.floor(clamped * counts.length);
    counts[index] += 1;
  }
  return CONFIDENCE_BUCKET_LABELS.map((bucket, i) => ({ bucket, count: counts[i] }));
}

// Real frequency count - across a window's clips, how often each signal
// appears in that clip's highlightExplainability.topFactors. Descending, so
// the most-influential signals float to the top.
export function computeMostCommonSignals(
  topFactorsPerClip: string[][],
): Array<{ signal: string; count: number }> {
  const counts = new Map<string, number>();
  for (const signals of topFactorsPerClip) {
    for (const signal of signals) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([signal, count]) => ({ signal, count }))
    .sort((a, b) => b.count - a.count);
}

// Percent change vs. the immediately preceding period of equal length.
// Null (not a fabricated 0%/±Infinity%) when there's no prior-period data
// to compare against - "no baseline" is not "no growth."
export function computeGrowthPct(currentCount: number, previousCount: number): number | null {
  if (previousCount === 0) return null;
  return Math.round(((currentCount - previousCount) / previousCount) * 1000) / 10;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Zero-filled, same convention as analytics.util.ts's bucketUploadsByDay -
// bucketed by PUBLISH date, not snapshot-capture date, because
// `publishCount` only makes sense as "how many clips went live this day";
// totalViews/averageEngagementScore per day are the latest-known stats for
// whatever was published that day, not a growing view-count-over-time
// series.
export function bucketByPublishDate(
  records: Array<{ publishedAt: Date; viewCount: number | null; engagementScore: number | null }>,
  days: number,
  now: Date = new Date(),
): EngagementTrendPoint[] {
  const buckets = new Map<
    string,
    { totalViews: number; engagementScores: number[]; publishCount: number }
  >();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(toDateKey(d), { totalViews: 0, engagementScores: [], publishCount: 0 });
  }

  for (const record of records) {
    const bucket = buckets.get(toDateKey(record.publishedAt));
    if (!bucket) continue;
    bucket.publishCount += 1;
    bucket.totalViews += record.viewCount ?? 0;
    if (record.engagementScore !== null) bucket.engagementScores.push(record.engagementScore);
  }

  return Array.from(buckets.entries()).map(([date, b]) => ({
    date,
    totalViews: b.totalViews,
    averageEngagementScore:
      b.engagementScores.length === 0
        ? null
        : b.engagementScores.reduce((sum, v) => sum + v, 0) / b.engagementScores.length,
    publishCount: b.publishCount,
  }));
}

// Sprint 6B (Analytics Dashboard Expansion - Trend granularity). Generalizes
// bucketByPublishDate's day-only bucketing to also support week/month/year,
// reusing that function's zero-filled, "bucket by publish date not
// snapshot-capture date" design. bucketByPublishDate itself is left
// untouched (still used by apps/worker's Analytics Report PDF adapter) -
// this is a new, additive sibling, not a replacement.

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Standard ISO 8601 week algorithm (Thursday-of-the-week trick): the week
// containing a date's Thursday determines both the week's year and number,
// which is what makes "week 1" well-defined even when Jan 1 falls in the
// last week of the previous ISO year.
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function yearKey(date: Date): string {
  return String(date.getFullYear());
}

function periodKey(date: Date, granularity: TrendGranularity): string {
  switch (granularity) {
    case 'daily':
      return dayKey(date);
    case 'weekly':
      return isoWeekKey(date);
    case 'monthly':
      return monthKey(date);
    case 'yearly':
      return yearKey(date);
  }
}

// Steps back n whole periods from `date`, anchored to the start of the
// current period before subtracting - avoids JS's day-of-month overflow
// (e.g. naively doing "March 31 minus 1 month" lands on a nonexistent
// "Feb 31", which Date normalizes forward into early March instead of
// February).
function stepBackToPeriodStart(date: Date, granularity: TrendGranularity, n: number): Date {
  switch (granularity) {
    case 'daily': {
      const d = new Date(date);
      d.setDate(d.getDate() - n);
      return d;
    }
    case 'weekly': {
      const d = new Date(date);
      d.setDate(d.getDate() - n * 7);
      return d;
    }
    case 'monthly': {
      const d = new Date(date.getFullYear(), date.getMonth(), 1);
      d.setMonth(d.getMonth() - n);
      return d;
    }
    case 'yearly': {
      const d = new Date(date.getFullYear(), 0, 1);
      d.setFullYear(d.getFullYear() - n);
      return d;
    }
  }
}

// periods=30 + granularity='daily' reproduces bucketByPublishDate's own
// bucket keys exactly (same dayKey computation) - this function is a strict
// superset, not a divergent reimplementation.
export function bucketByPublishPeriod(
  records: Array<{ publishedAt: Date; viewCount: number | null; engagementScore: number | null }>,
  granularity: TrendGranularity,
  periods: number,
  now: Date = new Date(),
): EngagementTrendPoint[] {
  const buckets = new Map<
    string,
    { totalViews: number; engagementScores: number[]; publishCount: number }
  >();
  for (let i = periods - 1; i >= 0; i--) {
    const key = periodKey(stepBackToPeriodStart(now, granularity, i), granularity);
    if (!buckets.has(key)) {
      buckets.set(key, { totalViews: 0, engagementScores: [], publishCount: 0 });
    }
  }

  for (const record of records) {
    const bucket = buckets.get(periodKey(record.publishedAt, granularity));
    if (!bucket) continue;
    bucket.publishCount += 1;
    bucket.totalViews += record.viewCount ?? 0;
    if (record.engagementScore !== null) bucket.engagementScores.push(record.engagementScore);
  }

  return Array.from(buckets.entries()).map(([date, b]) => ({
    date,
    totalViews: b.totalViews,
    averageEngagementScore:
      b.engagementScores.length === 0
        ? null
        : b.engagementScores.reduce((sum, v) => sum + v, 0) / b.engagementScores.length,
    publishCount: b.publishCount,
  }));
}

// Translates the existing `days` window filter into a bucket count for a
// given granularity, so callers don't need a second "how many buckets"
// query param - e.g. days=90 + granularity='weekly' shows ~13 weekly
// buckets covering the same 90-day window platformComparison/growthSummary
// already use.
export function periodsForGranularity(days: number, granularity: TrendGranularity): number {
  switch (granularity) {
    case 'daily':
      return days;
    case 'weekly':
      return Math.max(1, Math.ceil(days / 7));
    case 'monthly':
      return Math.max(1, Math.ceil(days / 30));
    case 'yearly':
      return Math.max(1, Math.ceil(days / 365));
  }
}

export interface GrowthSummaryRecord {
  viewCount: number | null;
  engagementScore: number | null;
}

export interface GrowthSummaryInput {
  videos: { current: number; previous: number };
  clips: { current: number; previous: number };
  currentRecords: GrowthSummaryRecord[];
  previousRecords: GrowthSummaryRecord[];
}

function sumViews(records: GrowthSummaryRecord[]): number {
  return records.reduce((sum, r) => sum + (r.viewCount ?? 0), 0);
}

function averageEngagement(records: GrowthSummaryRecord[]): number | null {
  const scores = records.map((r) => r.engagementScore).filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

// The one implementation of "growth" for the report's 4 top-line metrics
// (Total Views, Average Engagement, Total Videos, Total Clips) - called
// identically by AnalyticsService.getPerformance() (live dashboard) and the
// Analytics Report worker adapter (PDF), so the two surfaces can never
// disagree on what growth means. Views/Engagement are reduced from
// currentRecords/previousRecords (data both callers already fetch for
// engagementTrend/platformComparison) - videos/clips come from 2 lightweight
// windowed counts each caller runs itself.
export function computeGrowthSummary(input: GrowthSummaryInput): GrowthSummary {
  const currentViews = sumViews(input.currentRecords);
  const previousViews = sumViews(input.previousRecords);
  const currentEngagement = averageEngagement(input.currentRecords);
  const previousEngagement = averageEngagement(input.previousRecords);

  return {
    views: {
      current: currentViews,
      previous: previousViews,
      growthPct: computeGrowthPct(currentViews, previousViews),
    },
    engagementScore: {
      current: currentEngagement,
      previous: previousEngagement,
      growthPct:
        currentEngagement === null || previousEngagement === null
          ? null
          : computeGrowthPct(currentEngagement, previousEngagement),
    },
    videos: {
      current: input.videos.current,
      previous: input.videos.previous,
      growthPct: computeGrowthPct(input.videos.current, input.videos.previous),
    },
    clips: {
      current: input.clips.current,
      previous: input.clips.previous,
      growthPct: computeGrowthPct(input.clips.current, input.clips.previous),
    },
  };
}
