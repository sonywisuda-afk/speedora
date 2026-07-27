'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import type {
  NotificationCategoryV2,
  NotificationPriorityV2,
  NotificationV2Dto,
  NotificationV2ListDto,
  NotificationV2StateFilter,
} from '@speedora/shared';
import {
  archiveNotificationsV2,
  deleteNotificationsV2,
  getUnreadNotificationCountV2,
  listNotificationsV2,
  markAllNotificationsReadV2,
  markNotificationsReadV2,
} from './api';
import { useNotificationStream } from './useNotificationStream';

export interface NotificationCenterFilters {
  state: NotificationV2StateFilter;
  category: NotificationCategoryV2 | null;
  priority: NotificationPriorityV2 | null;
  q: string;
}

const DEFAULT_FILTERS: NotificationCenterFilters = {
  state: 'all',
  category: null,
  priority: null,
  q: '',
};

const PAGE_LIMIT = 25;

// De-dupes by id, keeping the FIRST occurrence across pages - a resurfaced
// thread (moved to page 1 after an update) can transiently still appear in
// an as-yet-unrevalidated later page's cached data; page 0 (iterated first)
// always reflects the current real position once revalidation settles, so
// "first wins" self-corrects rather than rendering the same id twice.
function flattenDedup(pages: NotificationV2ListDto[] | undefined): NotificationV2Dto[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const result: NotificationV2Dto[] = [];
  for (const page of pages) {
    for (const notification of page.notifications) {
      if (seen.has(notification.id)) continue;
      seen.add(notification.id);
      result.push(notification);
    }
  }
  return result;
}

// Notification Center v2 Phase 4 (Realtime & Frontend Integration) - the one
// hook driving the full-page Notification Center: cursor-paginated infinite
// list (useSWRInfinite, same cursor convention as the API), filter/search
// state, multi-select, bulk actions, and the SSE wiring. Reuses
// useNotificationStream() completely UNCHANGED (same EventSource, same
// dumb "something changed, refetch" nudge, same auto-reconnect) - this hook
// only decides what to DO with the nudge, never touches the SSE transport
// itself.
export function useNotificationCenter() {
  const [filters, setFilters] = useState<NotificationCenterFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const previousRef = useRef<Map<string, string> | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const getKey = useCallback(
    (
      pageIndex: number,
      previousPageData: NotificationV2ListDto | null,
    ): [string, string, string | undefined] | null => {
      if (previousPageData && !previousPageData.nextCursor) return null;
      const cursor = pageIndex === 0 ? undefined : (previousPageData?.nextCursor ?? undefined);
      return ['notifications-v2', filterKey, cursor];
    },
    [filterKey],
  );

  const {
    data,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate: mutateList,
  } = useSWRInfinite(getKey, ([, , cursor]) =>
    listNotificationsV2({
      cursor,
      limit: PAGE_LIMIT,
      state: filters.state,
      category: filters.category ?? undefined,
      priority: filters.priority ?? undefined,
      q: filters.q || undefined,
    }),
  );

  const { data: unread, mutate: mutateUnread } = useSWR(
    'notifications-v2-unread-count',
    getUnreadNotificationCountV2,
    { refreshInterval: 120000 },
  );

  const notifications = useMemo(() => flattenDedup(data), [data]);
  const hasMore = data ? data[data.length - 1]?.nextCursor != null : true;

  // Establishes the baseline for SSE-diffing below, once, after the FIRST
  // real page load - never announces the initial list as "N notifications
  // updated" (that's just the page loading, not a real-time change).
  useEffect(() => {
    if (!previousRef.current && !isLoading && notifications.length > 0) {
      previousRef.current = new Map(notifications.map((n) => [n.id, n.updatedAt]));
    }
  }, [isLoading, notifications]);

  // Milestone 04c's SSE contract, unchanged: the payload carries no
  // notification data, just a nudge. Diffing happens client-side, AFTER
  // revalidating, comparing against the baseline snapshot above - this is
  // what lets the screen-reader announcement name what actually changed
  // ("Video X selesai diproses") instead of a generic "something happened".
  const { connected } = useNotificationStream(() => {
    void (async () => {
      const fresh = await mutateList();
      void mutateUnread();
      const freshFlat = flattenDedup(fresh);
      const prev = previousRef.current;
      if (prev && freshFlat.length > 0) {
        const changed = freshFlat.filter((n) => prev.get(n.id) !== n.updatedAt);
        if (changed.length === 1) {
          setAnnouncement(`Notifikasi diperbarui: ${changed[0].title}`);
        } else if (changed.length > 1) {
          setAnnouncement(`${changed.length} notifikasi diperbarui`);
        }
      }
      previousRef.current = new Map(freshFlat.map((n) => [n.id, n.updatedAt]));
    })();
  });

  function updateFilters(patch: Partial<NotificationCenterFilters>) {
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
    setSelected(new Set(notifications.map((n) => n.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function refresh() {
    await mutateList();
    await mutateUnread();
  }

  async function bulkMarkRead() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await markNotificationsReadV2(ids);
    clearSelection();
    await refresh();
  }

  async function markAllRead() {
    await markAllNotificationsReadV2();
    await refresh();
  }

  async function bulkArchive() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await archiveNotificationsV2(ids);
    clearSelection();
    await refresh();
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await deleteNotificationsV2(ids);
    clearSelection();
    await refresh();
  }

  return {
    filters,
    updateFilters,
    notifications,
    isLoading,
    isValidating,
    error,
    hasMore,
    loadMore,
    selected,
    toggleSelected,
    selectAll,
    clearSelection,
    unreadCount: unread?.count ?? 0,
    connected,
    announcement,
    refresh,
    bulkMarkRead,
    markAllRead,
    bulkArchive,
    bulkDelete,
  };
}
