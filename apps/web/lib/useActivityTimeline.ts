'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { ActivityEventDto, ActivityEventType, DashboardActivityDto } from '@speedora/shared';
import {
  deleteActivityEvents,
  deleteAllActivityEvents,
  getDashboardActivity,
} from './api';
import { ACTIVITY_PAGE_LIMIT } from './activity-events';
import { groupActivityEventsByTimeBucket, type ActivityBucketGroup } from './activity-time-buckets';

export interface ActivityTimelineFilters {
  q: string;
  type: ActivityEventType | null;
}

const DEFAULT_FILTERS: ActivityTimelineFilters = { q: '', type: null };

function isDefaultFilters(filters: ActivityTimelineFilters): boolean {
  return filters.q === '' && filters.type === null;
}

// De-dupes by id, keeping the FIRST occurrence across pages - same
// self-correcting reasoning as useNotificationCenter.ts's own flattenDedup
// (a row that moved position after an update can transiently still appear
// in an as-yet-unrevalidated later page).
function flattenDedup(pages: DashboardActivityDto[] | undefined): ActivityEventDto[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const result: ActivityEventDto[] = [];
  for (const page of pages) {
    for (const event of page.events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      result.push(event);
    }
  }
  return result;
}

// Activity Timeline v2 - the one hook driving the dashboard's Activity
// Timeline: cursor-paginated infinite list (useSWRInfinite, same cursor
// convention as useNotificationCenter.ts), time-bucket grouping, filter/
// search state, multi-select, delete actions, and a lightweight polling-
// based "new activity" banner (no SSE - see plan's rationale for why a
// single-row 10s poll is the right-sized substitute here).
export function useActivityTimeline({
  initialActivity,
}: {
  initialActivity?: DashboardActivityDto;
} = {}) {
  const [filters, setFilters] = useState<ActivityTimelineFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const newActivityBaselineRef = useRef<string | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const getKey = useCallback(
    (
      pageIndex: number,
      previousPageData: DashboardActivityDto | null,
    ): [string, string, string | undefined] | null => {
      if (previousPageData && !previousPageData.nextCursor) return null;
      const cursor = pageIndex === 0 ? undefined : (previousPageData?.nextCursor ?? undefined);
      return ['dashboard-activity', filterKey, cursor];
    },
    [filterKey],
  );

  // SSR only ever fetched the unfiltered first page (DashboardSummary.tsx),
  // so seeding is only valid while filters are still at their default -
  // seeding a filtered key with unfiltered data would show unrelated rows
  // as if they matched.
  const seedData: [DashboardActivityDto] | undefined =
    isDefaultFilters(filters) && initialActivity ? [initialActivity] : undefined;

  const {
    data,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate: mutateList,
  } = useSWRInfinite(
    getKey,
    ([, , cursor]) =>
      getDashboardActivity({
        cursor,
        limit: ACTIVITY_PAGE_LIMIT,
        q: filters.q || undefined,
        type: filters.type ?? undefined,
      }),
    { fallbackData: seedData },
  );

  const events = useMemo(() => flattenDedup(data), [data]);
  const grouped: ActivityBucketGroup[] = useMemo(
    () => groupActivityEventsByTimeBucket(events),
    [events],
  );
  const hasMore = data ? data[data.length - 1]?.nextCursor != null : true;

  // Separate cache key, separate fetch, never touches useSWRInfinite's own
  // cache - a cheap single-row poll purely to detect "is there something
  // newer than what's loaded" without re-fetching the whole list every 10s.
  const { data: peek, mutate: mutatePeek } = useSWR(
    'dashboard-activity-peek',
    () => getDashboardActivity({ limit: 1 }),
    { refreshInterval: 10000, revalidateOnFocus: false },
  );

  // Establishes the baseline once, after the FIRST real page load - never
  // announces the initial mount as "new activity available", same gating
  // reasoning as useNotificationCenter.ts's own previousRef.
  useEffect(() => {
    if (!newActivityBaselineRef.current && !isLoading && events.length > 0) {
      newActivityBaselineRef.current = events[0].id;
    }
  }, [isLoading, events]);

  const hasNewActivity = Boolean(
    newActivityBaselineRef.current &&
      peek?.events[0] &&
      peek.events[0].id !== newActivityBaselineRef.current,
  );

  async function showNewActivity() {
    const fresh = await mutateList();
    const freshFlat = flattenDedup(fresh);
    if (freshFlat.length > 0) newActivityBaselineRef.current = freshFlat[0].id;
    void mutatePeek();
  }

  function updateFilters(patch: Partial<ActivityTimelineFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSelected(new Set());
  }

  function loadMore() {
    if (!hasMore || isValidating) return;
    void setSize(size + 1);
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(events.map((e) => e.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function deleteOne(id: string) {
    await deleteActivityEvents([id]);
    clearSelection();
    await mutateList();
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await deleteActivityEvents(ids);
    clearSelection();
    await mutateList();
  }

  // Invalidates every cursor unconditionally (unlike deleteOne/
  // deleteSelected, which just refresh loaded pages) - explicitly collapses
  // back to a single fresh page rather than discarding the user's "Load
  // More" progress on every single/selected delete, an intentional
  // asymmetry.
  async function deleteAll() {
    await deleteAllActivityEvents();
    clearSelection();
    await setSize(1);
    await mutateList();
    newActivityBaselineRef.current = null;
  }

  return {
    filters,
    updateFilters,
    events,
    grouped,
    isLoading,
    isValidating,
    error,
    hasMore,
    loadMore,
    selected,
    toggleSelected,
    selectAll,
    clearSelection,
    hasNewActivity,
    showNewActivity,
    deleteOne,
    deleteSelected,
    deleteAll,
  };
}
