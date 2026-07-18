import type { CalendarEntryDto } from '@speedora/shared';
import { buildMonthGrid, dateKey, groupEntriesByDate, parseDateKey } from './calendar';

function flat(weeks: Date[][]): Date[] {
  return weeks.flat();
}

describe('buildMonthGrid', () => {
  it('produces only complete 7-day weeks, starting on Sunday and ending on Saturday', () => {
    const weeks = buildMonthGrid(2026, 6); // July 2026

    for (const week of weeks) {
      expect(week).toHaveLength(7);
    }
    expect(weeks[0][0].getDay()).toBe(0);
    expect(weeks[weeks.length - 1][6].getDay()).toBe(6);
  });

  it('includes every day of the target month exactly once', () => {
    const year = 2026;
    const month = 6; // July - 31 days
    const days = flat(buildMonthGrid(year, month)).filter((d) => d.getMonth() === month);

    expect(days).toHaveLength(31);
    expect(days.map((d) => d.getDate())).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it('leads with exactly firstOfMonth.getDay() days from the previous month', () => {
    const year = 2026;
    const month = 6; // July 2026
    const firstOfMonth = new Date(year, month, 1);
    const weeks = buildMonthGrid(year, month);

    const leadingDays = flat(weeks).filter((d) => d.getMonth() !== month && d < firstOfMonth);
    expect(leadingDays).toHaveLength(firstOfMonth.getDay());
  });

  it('produces between 4 and 6 weeks for any month', () => {
    for (let month = 0; month < 12; month++) {
      const weeks = buildMonthGrid(2026, month);
      expect(weeks.length).toBeGreaterThanOrEqual(4);
      expect(weeks.length).toBeLessThanOrEqual(6);
    }
  });

  it('produces exactly 5 weeks for a month needing only 5 (September 2026)', () => {
    // Sept 1 2026 is a Tuesday, 30 days -> fits in 5 weeks (Sun-start grid).
    const weeks = buildMonthGrid(2026, 8);
    expect(weeks).toHaveLength(5);
  });

  it('produces exactly 6 weeks for a month whose layout needs it (August 2026)', () => {
    // Aug 1 2026 is a Saturday, 31 days -> spills into a 6th week.
    const weeks = buildMonthGrid(2026, 7);
    expect(weeks).toHaveLength(6);
  });
});

describe('dateKey', () => {
  it('formats as local-date YYYY-MM-DD, zero-padded', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('parseDateKey', () => {
  it('round-trips with dateKey without a UTC-parsing day shift', () => {
    const original = new Date(2026, 0, 1); // Jan 1 - a common UTC-parsing pitfall date
    const key = dateKey(original);
    const parsed = parseDateKey(key);

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(0);
    expect(parsed.getDate()).toBe(1);
    expect(dateKey(parsed)).toBe(key);
  });
});

describe('groupEntriesByDate', () => {
  function entry(overrides: Partial<CalendarEntryDto>): CalendarEntryDto {
    return {
      id: 'e1',
      clipId: 'clip-1',
      clipHookText: null,
      platform: 'TIKTOK' as CalendarEntryDto['platform'],
      status: 'PUBLISHED' as CalendarEntryDto['status'],
      date: '2026-07-15T12:00:00.000Z',
      campaignId: null,
      campaignName: null,
      errorMessage: null,
      ...overrides,
    };
  }

  it('groups multiple entries falling on the same local day under one key', () => {
    const entries = [
      entry({ id: 'a', date: new Date(2026, 6, 15, 9, 0).toISOString() }),
      entry({ id: 'b', date: new Date(2026, 6, 15, 20, 0).toISOString() }),
      entry({ id: 'c', date: new Date(2026, 6, 16, 9, 0).toISOString() }),
    ];

    const grouped = groupEntriesByDate(entries);

    expect(grouped.get('2026-07-15')).toHaveLength(2);
    expect(grouped.get('2026-07-16')).toHaveLength(1);
    expect(grouped.size).toBe(2);
  });

  it('buckets by the viewer local date, not the raw UTC date, near a midnight boundary', () => {
    // 2026-07-15T23:30 in UTC-2 is 2026-07-16T01:30 local - a UTC-vs-local
    // date mismatch this function must resolve using local date parts, same
    // convention as buildMonthGrid.
    const utcLateNight = '2026-07-15T23:30:00.000Z';
    const localDate = new Date(utcLateNight);
    const expectedKey = dateKey(localDate);

    const grouped = groupEntriesByDate([entry({ id: 'a', date: utcLateNight })]);

    expect(grouped.get(expectedKey)).toHaveLength(1);
  });
});
