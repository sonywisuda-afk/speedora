import type { CalendarEntryDto } from '@speedora/shared';

// Publishing Expansion Phase 6D (Calendar view) - pure, no-JSX helpers,
// same "testable without a component-testing framework" reasoning as
// lib/export.ts/lib/platform-copy.ts. No date/calendar library exists
// anywhere in this repo (confirmed during planning) - this is plain
// Date arithmetic, same posture as apps/api's next-slot.util.ts.

// Local-date (not UTC) YYYY-MM-DD key - matches buildMonthGrid's own local
// Date construction, so a grid cell's key always matches the key an entry
// on that same calendar day gets grouped under, regardless of the viewer's
// UTC offset.
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// `month` is 0-indexed (JS Date convention: 0=January). Returns as many
// full weeks as needed to cover every day of the month (4-6 rows,
// depending on the month/leading weekday), each week starting Sunday -
// not a fixed 6 rows, so a short month doesn't render trailing empty weeks.
export function buildMonthGrid(year: number, month: number): Date[][] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());

  const weeks: Date[][] = [];
  let cursor = gridStart;
  for (;;) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor.getTime() > lastOfMonth.getTime()) break;
  }
  return weeks;
}

// Inverse of dateKey() - reconstructs a local Date from a "YYYY-MM-DD" key.
// Never `new Date(key)` directly for this: that parses as UTC midnight,
// which can display as the previous day in a negative UTC-offset timezone.
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Buckets entries by their own `date` field (already the server-computed
// publishedAt ?? scheduledAt ?? createdAt fallback - see CalendarEntryDto)
// into the same local-date keys buildMonthGrid's cells use.
export function groupEntriesByDate(
  entries: CalendarEntryDto[],
): Map<string, CalendarEntryDto[]> {
  const grouped = new Map<string, CalendarEntryDto[]>();
  for (const entry of entries) {
    const key = dateKey(new Date(entry.date));
    const existing = grouped.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(key, [entry]);
    }
  }
  return grouped;
}
