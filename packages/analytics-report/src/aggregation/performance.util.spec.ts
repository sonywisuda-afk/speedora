import {
  bucketByPublishDate,
  bucketByPublishPeriod,
  computeConfidenceDistribution,
  computeGrowthPct,
  computeGrowthSummary,
  computeMostCommonSignals,
  periodsForGranularity,
} from './performance.util';

describe('computeConfidenceDistribution', () => {
  it('buckets confidences into 5 fixed-width ranges', () => {
    const result = computeConfidenceDistribution([0.1, 0.25, 0.5, 0.75, 0.95]);
    expect(result).toEqual([
      { bucket: '0.0-0.2', count: 1 },
      { bucket: '0.2-0.4', count: 1 },
      { bucket: '0.4-0.6', count: 1 },
      { bucket: '0.6-0.8', count: 1 },
      { bucket: '0.8-1.0', count: 1 },
    ]);
  });

  it('puts a confidence of exactly 1 in the last bucket, not overflowing', () => {
    const result = computeConfidenceDistribution([1]);
    expect(result[4].count).toBe(1);
  });

  it('returns all-zero buckets for an empty input', () => {
    const result = computeConfidenceDistribution([]);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });
});

describe('computeMostCommonSignals', () => {
  it('counts signal frequency across clips, sorted descending', () => {
    const result = computeMostCommonSignals([['audio', 'scene'], ['audio'], ['facial']]);
    expect(result).toEqual([
      { signal: 'audio', count: 2 },
      { signal: 'scene', count: 1 },
      { signal: 'facial', count: 1 },
    ]);
  });

  it('returns an empty array when no clips have top factors', () => {
    expect(computeMostCommonSignals([])).toEqual([]);
    expect(computeMostCommonSignals([[], []])).toEqual([]);
  });
});

describe('computeGrowthPct', () => {
  it('computes percent change vs the previous period', () => {
    expect(computeGrowthPct(15, 10)).toBe(50);
    expect(computeGrowthPct(5, 10)).toBe(-50);
    expect(computeGrowthPct(10, 10)).toBe(0);
  });

  it('returns null when there is no prior-period data, not a fabricated value', () => {
    expect(computeGrowthPct(10, 0)).toBeNull();
    expect(computeGrowthPct(0, 0)).toBeNull();
  });
});

describe('bucketByPublishDate', () => {
  const now = new Date('2026-01-10T12:00:00.000Z');

  it('zero-fills every day with no publishes', () => {
    const result = bucketByPublishDate([], 3, now);
    expect(result).toEqual([
      { date: '2026-01-08', totalViews: 0, averageEngagementScore: null, publishCount: 0 },
      { date: '2026-01-09', totalViews: 0, averageEngagementScore: null, publishCount: 0 },
      { date: '2026-01-10', totalViews: 0, averageEngagementScore: null, publishCount: 0 },
    ]);
  });

  it('aggregates publishCount/totalViews/averageEngagementScore per day', () => {
    const result = bucketByPublishDate(
      [
        { publishedAt: new Date('2026-01-09T01:00:00.000Z'), viewCount: 100, engagementScore: 0.2 },
        { publishedAt: new Date('2026-01-09T05:00:00.000Z'), viewCount: 50, engagementScore: 0.4 },
        { publishedAt: new Date('2026-01-10T00:00:00.000Z'), viewCount: 10, engagementScore: null },
      ],
      3,
      now,
    );
    const jan9 = result.find((r) => r.date === '2026-01-09')!;
    expect(jan9.publishCount).toBe(2);
    expect(jan9.totalViews).toBe(150);
    expect(jan9.averageEngagementScore).toBeCloseTo(0.3);

    const jan10 = result.find((r) => r.date === '2026-01-10')!;
    expect(jan10.publishCount).toBe(1);
    expect(jan10.totalViews).toBe(10);
    // Only null engagementScore that day -> no data to average.
    expect(jan10.averageEngagementScore).toBeNull();
  });

  it('drops records outside the window', () => {
    const result = bucketByPublishDate(
      [{ publishedAt: new Date('2025-01-01'), viewCount: 999, engagementScore: 1 }],
      3,
      now,
    );
    expect(result.reduce((sum, r) => sum + r.publishCount, 0)).toBe(0);
  });

  it('treats a null viewCount as 0, not skipping the record', () => {
    const result = bucketByPublishDate(
      [
        {
          publishedAt: new Date('2026-01-10T00:00:00.000Z'),
          viewCount: null,
          engagementScore: null,
        },
      ],
      3,
      now,
    );
    const jan10 = result.find((r) => r.date === '2026-01-10')!;
    expect(jan10.publishCount).toBe(1);
    expect(jan10.totalViews).toBe(0);
  });
});

describe('computeGrowthSummary', () => {
  it('computes growthPct: null for every metric when there is no previous-window data at all', () => {
    const result = computeGrowthSummary({
      videos: { current: 5, previous: 0 },
      clips: { current: 12, previous: 0 },
      currentRecords: [{ viewCount: 100, engagementScore: 0.5 }],
      previousRecords: [],
    });
    expect(result.videos.growthPct).toBeNull();
    expect(result.clips.growthPct).toBeNull();
    expect(result.views.growthPct).toBeNull();
    expect(result.engagementScore.growthPct).toBeNull();
  });

  it('sums viewCount and averages engagementScore per window, then computes growthPct', () => {
    const result = computeGrowthSummary({
      videos: { current: 8, previous: 5 },
      clips: { current: 20, previous: 10 },
      currentRecords: [
        { viewCount: 100, engagementScore: 0.4 },
        { viewCount: 50, engagementScore: 0.6 },
      ],
      previousRecords: [{ viewCount: 100, engagementScore: 0.5 }],
    });

    expect(result.views).toEqual({ current: 150, previous: 100, growthPct: 50 });
    expect(result.engagementScore.current).toBeCloseTo(0.5);
    expect(result.engagementScore.previous).toBe(0.5);
    expect(result.engagementScore.growthPct).toBe(0);
    expect(result.videos).toEqual({ current: 8, previous: 5, growthPct: 60 });
    expect(result.clips).toEqual({ current: 20, previous: 10, growthPct: 100 });
  });

  it('handles a fully empty account without throwing - all counts 0, engagementScore null', () => {
    const result = computeGrowthSummary({
      videos: { current: 0, previous: 0 },
      clips: { current: 0, previous: 0 },
      currentRecords: [],
      previousRecords: [],
    });
    expect(result.views).toEqual({ current: 0, previous: 0, growthPct: null });
    expect(result.engagementScore).toEqual({ current: null, previous: null, growthPct: null });
    expect(result.videos).toEqual({ current: 0, previous: 0, growthPct: null });
    expect(result.clips).toEqual({ current: 0, previous: 0, growthPct: null });
  });

  it('treats a null viewCount as 0 when summing, same as bucketByPublishDate', () => {
    const result = computeGrowthSummary({
      videos: { current: 1, previous: 1 },
      clips: { current: 1, previous: 1 },
      currentRecords: [{ viewCount: null, engagementScore: null }],
      previousRecords: [{ viewCount: 20, engagementScore: 0.3 }],
    });
    expect(result.views).toEqual({ current: 0, previous: 20, growthPct: -100 });
  });

  it('reports growthPct: null for engagementScore when either window has no scored records, even if the other does', () => {
    const result = computeGrowthSummary({
      videos: { current: 1, previous: 1 },
      clips: { current: 1, previous: 1 },
      currentRecords: [{ viewCount: 10, engagementScore: 0.9 }],
      previousRecords: [{ viewCount: 10, engagementScore: null }],
    });
    expect(result.engagementScore.current).toBe(0.9);
    expect(result.engagementScore.previous).toBeNull();
    expect(result.engagementScore.growthPct).toBeNull();
  });
});

describe('bucketByPublishPeriod', () => {
  const now = new Date('2026-01-10T12:00:00.000Z');

  it("with granularity 'daily' reproduces bucketByPublishDate's own bucket keys exactly", () => {
    const records = [
      { publishedAt: new Date('2026-01-09T01:00:00.000Z'), viewCount: 100, engagementScore: 0.2 },
      { publishedAt: new Date('2026-01-10T00:00:00.000Z'), viewCount: 10, engagementScore: null },
    ];
    expect(bucketByPublishPeriod(records, 'daily', 3, now)).toEqual(
      bucketByPublishDate(records, 3, now),
    );
  });

  it("zero-fills every ISO week with 'weekly' granularity", () => {
    const result = bucketByPublishPeriod([], 'weekly', 3, now);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.publishCount === 0 && r.averageEngagementScore === null)).toBe(
      true,
    );
    // 2026-01-10 falls in ISO week 2026-W02.
    expect(result[result.length - 1].date).toBe('2026-W02');
  });

  it("aggregates records into the correct ISO week with 'weekly' granularity", () => {
    const result = bucketByPublishPeriod(
      [
        // 2026-01-05 and 2026-01-08 are both in ISO week 2026-W02.
        { publishedAt: new Date('2026-01-05T00:00:00.000Z'), viewCount: 100, engagementScore: 0.2 },
        { publishedAt: new Date('2026-01-08T00:00:00.000Z'), viewCount: 50, engagementScore: 0.4 },
      ],
      'weekly',
      2,
      now,
    );
    const week = result.find((r) => r.date === '2026-W02')!;
    expect(week.publishCount).toBe(2);
    expect(week.totalViews).toBe(150);
    expect(week.averageEngagementScore).toBeCloseTo(0.3);
  });

  it("does not skip a short month (day-of-month overflow) with 'monthly' granularity", () => {
    // Naively doing "March 31 minus 1 month" via Date.setMonth lands on a
    // nonexistent "Feb 31", which JS normalizes forward into early March -
    // this test guards against that regressing and silently dropping
    // February from the trend.
    const marchEnd = new Date('2026-03-31T12:00:00.000Z');
    const result = bucketByPublishPeriod([], 'monthly', 2, marchEnd);
    expect(result.map((r) => r.date)).toEqual(['2026-02', '2026-03']);
  });

  it("zero-fills every calendar year with 'yearly' granularity", () => {
    const midYear = new Date('2026-06-15T00:00:00.000Z');
    const result = bucketByPublishPeriod([], 'yearly', 2, midYear);
    expect(result.map((r) => r.date)).toEqual(['2025', '2026']);
  });

  it("drops records outside the window with 'monthly' granularity", () => {
    const result = bucketByPublishPeriod(
      [{ publishedAt: new Date('2020-01-01'), viewCount: 999, engagementScore: 1 }],
      'monthly',
      2,
      now,
    );
    expect(result.reduce((sum, r) => sum + r.publishCount, 0)).toBe(0);
  });
});

describe('periodsForGranularity', () => {
  it('returns the day count unchanged for daily', () => {
    expect(periodsForGranularity(90, 'daily')).toBe(90);
  });

  it('converts a day window into a bucket count for coarser granularities', () => {
    expect(periodsForGranularity(90, 'weekly')).toBe(13);
    expect(periodsForGranularity(90, 'monthly')).toBe(3);
    expect(periodsForGranularity(90, 'yearly')).toBe(1);
  });

  it('never returns fewer than 1 bucket for a small window', () => {
    expect(periodsForGranularity(7, 'yearly')).toBe(1);
  });
});
