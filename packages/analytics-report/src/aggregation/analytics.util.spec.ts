import { bucketUploadsByDay, computeAverageEngagementScore } from './analytics.util';

describe('computeAverageEngagementScore', () => {
  it('returns null when there are no snapshots', () => {
    expect(computeAverageEngagementScore([])).toBeNull();
  });

  it('returns null when every latest snapshot has a null engagementScore', () => {
    const result = computeAverageEngagementScore([
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-01'), engagementScore: null },
    ]);
    expect(result).toBeNull();
  });

  it('averages the latest snapshot per publish record', () => {
    const result = computeAverageEngagementScore([
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-01'), engagementScore: 0.1 },
      // Later snapshot for pr-1 - this one should win, not the earlier 0.1.
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-02'), engagementScore: 0.5 },
      { publishRecordId: 'pr-2', capturedAt: new Date('2026-01-01'), engagementScore: 0.3 },
    ]);
    // mean(0.5, 0.3) = 0.4
    expect(result).toBeCloseTo(0.4);
  });

  it('ignores a publish record whose latest snapshot has a null engagementScore, but still uses others', () => {
    const result = computeAverageEngagementScore([
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-01'), engagementScore: null },
      { publishRecordId: 'pr-2', capturedAt: new Date('2026-01-01'), engagementScore: 0.6 },
    ]);
    expect(result).toBe(0.6);
  });

  it('is not affected by input order', () => {
    const a = computeAverageEngagementScore([
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-02'), engagementScore: 0.5 },
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-01'), engagementScore: 0.1 },
    ]);
    const b = computeAverageEngagementScore([
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-01'), engagementScore: 0.1 },
      { publishRecordId: 'pr-1', capturedAt: new Date('2026-01-02'), engagementScore: 0.5 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe(0.5);
  });
});

describe('bucketUploadsByDay', () => {
  const now = new Date('2026-01-10T12:00:00.000Z');

  it('zero-fills every day in the window, even with no uploads', () => {
    const result = bucketUploadsByDay([], 5, now);
    expect(result).toEqual([
      { date: '2026-01-06', count: 0 },
      { date: '2026-01-07', count: 0 },
      { date: '2026-01-08', count: 0 },
      { date: '2026-01-09', count: 0 },
      { date: '2026-01-10', count: 0 },
    ]);
  });

  it('counts uploads on their correct day', () => {
    const result = bucketUploadsByDay(
      [
        new Date('2026-01-08T03:00:00.000Z'),
        new Date('2026-01-08T20:00:00.000Z'),
        new Date('2026-01-10T00:00:00.000Z'),
      ],
      5,
      now,
    );
    const byDate = Object.fromEntries(result.map((r) => [r.date, r.count]));
    expect(byDate['2026-01-08']).toBe(2);
    expect(byDate['2026-01-10']).toBe(1);
    expect(byDate['2026-01-07']).toBe(0);
  });

  it('drops uploads outside the window', () => {
    const result = bucketUploadsByDay([new Date('2025-12-01T00:00:00.000Z')], 5, now);
    const total = result.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(0);
  });

  it('returns days in chronological order, oldest first', () => {
    const result = bucketUploadsByDay([], 3, now);
    expect(result.map((r) => r.date)).toEqual(['2026-01-08', '2026-01-09', '2026-01-10']);
  });
});
