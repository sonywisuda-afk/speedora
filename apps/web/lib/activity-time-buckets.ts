import type { ActivityEventDto } from '@speedora/shared';

export type ActivityTimeBucket = 'today' | 'yesterday' | 'last7Days' | 'thisMonth' | 'older';

export interface ActivityBucketGroup {
  bucket: ActivityTimeBucket;
  events: ActivityEventDto[];
}

const BUCKET_LABELS: Record<ActivityTimeBucket, string> = {
  today: 'Hari Ini',
  yesterday: 'Kemarin',
  last7Days: '7 Hari Terakhir',
  thisMonth: 'Bulan Ini',
  older: 'Lebih Lama',
};

export function activityBucketLabel(bucket: ActivityTimeBucket): string {
  return BUCKET_LABELS[bucket];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const MS_PER_DAY = 86_400_000;

// Activity Timeline v2 - local (browser) calendar-day bucketing, matching
// lib/dashboard.ts's formatRelativeTime own implicit-local-time approach
// (so "Kemarin" here and "X jam lalu" there never clash for the same
// event) - never computed server-side, same "no date library" constraint
// formatRelativeTime already holds to. `now` is an optional override purely
// for deterministic testing, same convention as formatRelativeTime's own
// `now` param - real callers never pass it.
//
// Partitions by dayDiff = floor((startOfLocalToday - startOfEventLocalDay)
// / 86400000): 0->today, 1->yesterday, 2..6->last7Days (a genuine 7-
// calendar-day span together with today+yesterday), same local year+month
// as `now`->thisMonth, else->older. A negative dayDiff (clock skew) clamps
// into `today` rather than crashing - same "fail open, degrade gracefully"
// posture isKnownActivityEventType's own comment documents elsewhere.
// Buckets with zero events are omitted; within a bucket, the server's
// original createdAt-desc ordering is preserved, never re-sorted.
//
// Known, accepted limitation: local-midnight Date diffing can be off by the
// DST offset (up to 1 hour) on the two DST-transition days per year -
// acceptable given the "no date library" constraint, not worth a dependency
// for.
export function groupActivityEventsByTimeBucket(
  events: ActivityEventDto[],
  now: Date = new Date(),
): ActivityBucketGroup[] {
  const todayStart = startOfLocalDay(now);
  const buckets = new Map<ActivityTimeBucket, ActivityEventDto[]>();

  for (const event of events) {
    const eventDate = new Date(event.createdAt);
    const eventDayStart = startOfLocalDay(eventDate);
    const dayDiff = Math.round((todayStart.getTime() - eventDayStart.getTime()) / MS_PER_DAY);

    let bucket: ActivityTimeBucket;
    if (dayDiff <= 0) {
      bucket = 'today';
    } else if (dayDiff === 1) {
      bucket = 'yesterday';
    } else if (dayDiff <= 6) {
      bucket = 'last7Days';
    } else if (
      eventDate.getFullYear() === now.getFullYear() &&
      eventDate.getMonth() === now.getMonth()
    ) {
      bucket = 'thisMonth';
    } else {
      bucket = 'older';
    }

    const existing = buckets.get(bucket);
    if (existing) existing.push(event);
    else buckets.set(bucket, [event]);
  }

  const order: ActivityTimeBucket[] = ['today', 'yesterday', 'last7Days', 'thisMonth', 'older'];
  return order
    .filter((bucket) => buckets.has(bucket))
    .map((bucket) => ({ bucket, events: buckets.get(bucket)! }));
}
