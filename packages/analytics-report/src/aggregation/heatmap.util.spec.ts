import { computePublishTimeHeatmap, type HeatmapRecord } from './heatmap.util';

describe('computePublishTimeHeatmap', () => {
  it('returns all 168 (7 x 24) cells, zero-filled, for no records', () => {
    const cells = computePublishTimeHeatmap([]);

    expect(cells).toHaveLength(168);
    expect(cells.every((c) => c.publishCount === 0)).toBe(true);
    expect(cells.every((c) => c.totalViews === 0)).toBe(true);
    expect(cells.every((c) => c.averageEngagementScore === null)).toBe(true);
  });

  it('covers every day 0-6 and every hour 0-23 exactly once', () => {
    const cells = computePublishTimeHeatmap([]);
    const keys = new Set(cells.map((c) => `${c.dayOfWeek}-${c.hour}`));

    expect(keys.size).toBe(168);
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        expect(keys.has(`${day}-${hour}`)).toBe(true);
      }
    }
  });

  it('buckets a record by UTC day-of-week and hour', () => {
    // 2026-07-19 is a Sunday (dayOfWeek 0); 14:30 UTC falls in the 14 hour bucket.
    const record: HeatmapRecord = {
      publishedAt: new Date('2026-07-19T14:30:00.000Z'),
      viewCount: 100,
      engagementScore: 0.2,
    };

    const cells = computePublishTimeHeatmap([record]);
    const cell = cells.find((c) => c.dayOfWeek === 0 && c.hour === 14)!;

    expect(cell.publishCount).toBe(1);
    expect(cell.totalViews).toBe(100);
    expect(cell.averageEngagementScore).toBe(0.2);
  });

  it('aggregates multiple records landing in the same cell', () => {
    const records: HeatmapRecord[] = [
      { publishedAt: new Date('2026-07-19T14:10:00.000Z'), viewCount: 100, engagementScore: 0.2 },
      { publishedAt: new Date('2026-07-19T14:45:00.000Z'), viewCount: 200, engagementScore: 0.4 },
    ];

    const cells = computePublishTimeHeatmap(records);
    const cell = cells.find((c) => c.dayOfWeek === 0 && c.hour === 14)!;

    expect(cell.publishCount).toBe(2);
    expect(cell.totalViews).toBe(300);
    expect(cell.averageEngagementScore).toBeCloseTo(0.3);
  });

  it('treats a null viewCount as 0 for totals, but excludes a null engagementScore from the average', () => {
    const records: HeatmapRecord[] = [
      { publishedAt: new Date('2026-07-19T14:00:00.000Z'), viewCount: null, engagementScore: null },
      { publishedAt: new Date('2026-07-19T14:00:00.000Z'), viewCount: 50, engagementScore: 0.5 },
    ];

    const cells = computePublishTimeHeatmap(records);
    const cell = cells.find((c) => c.dayOfWeek === 0 && c.hour === 14)!;

    expect(cell.publishCount).toBe(2);
    expect(cell.totalViews).toBe(50);
    expect(cell.averageEngagementScore).toBe(0.5);
  });

  it('keeps different hours/days independent', () => {
    const records: HeatmapRecord[] = [
      { publishedAt: new Date('2026-07-19T09:00:00.000Z'), viewCount: 10, engagementScore: 0.1 }, // Sunday 09:00
      { publishedAt: new Date('2026-07-20T20:00:00.000Z'), viewCount: 20, engagementScore: 0.2 }, // Monday 20:00
    ];

    const cells = computePublishTimeHeatmap(records);
    const sunday9 = cells.find((c) => c.dayOfWeek === 0 && c.hour === 9)!;
    const monday20 = cells.find((c) => c.dayOfWeek === 1 && c.hour === 20)!;
    const untouched = cells.find((c) => c.dayOfWeek === 2 && c.hour === 5)!;

    expect(sunday9.publishCount).toBe(1);
    expect(monday20.publishCount).toBe(1);
    expect(untouched.publishCount).toBe(0);
  });
});
