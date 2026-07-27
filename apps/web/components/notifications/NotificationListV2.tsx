'use client';

import { AlertTriangle, Inbox } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { NotificationV2Dto } from '@speedora/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationRowV2 } from './NotificationRowV2';

// Real infinite scroll (IntersectionObserver-driven auto-load) - this
// codebase's existing cursor-paginated pages (library, audit log) only ever
// had a manual "Load More" button; this is the first true auto-loading list.
// The button stays too, right below the sentinel, as an explicit fallback -
// some screen readers/keyboard-only flows handle an auto-triggering
// IntersectionObserver poorly, and a visible, focusable "Muat lebih banyak"
// control is a strictly more accessible guarantee than relying on scroll
// alone.
function LoadMoreSentinel({
  onIntersect,
  disabled,
}: {
  onIntersect: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onIntersect();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled, onIntersect]);

  return <div ref={ref} aria-hidden="true" className="h-1 w-full" />;
}

function RowSkeleton() {
  return (
    <li className="flex gap-3 border-b border-border p-3">
      <Skeleton className="mt-1 h-4 w-4 shrink-0 rounded" />
      <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-3 w-12 shrink-0" />
    </li>
  );
}

export function NotificationListV2({
  notifications,
  isLoading,
  error,
  hasMore,
  isValidating,
  onLoadMore,
  selected,
  onToggleSelect,
  onOpenThread,
  onAfterAction,
  onMarkRead,
  onRetry,
}: {
  notifications: NotificationV2Dto[];
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  isValidating: boolean;
  onLoadMore: () => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenThread: (threadId: string) => void;
  onAfterAction: () => void;
  onMarkRead: (id: string) => void;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <ul aria-busy="true" aria-label="Memuat notifikasi">
        {Array.from({ length: 6 }).map((_, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <RowSkeleton key={i} />
        ))}
      </ul>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive-surface p-8 text-center"
      >
        <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <div>
          <p className="font-body text-sm font-medium text-foreground">Gagal memuat notifikasi.</p>
          <p className="font-body text-xs text-muted-foreground">
            Periksa koneksi Anda dan coba lagi.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Coba Lagi
        </Button>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-12 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-body text-sm font-medium text-foreground">Belum ada notifikasi.</p>
          <p className="font-body text-xs text-muted-foreground">
            Notifikasi baru akan muncul di sini secara real-time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* role="feed" - the correct ARIA pattern for a scrollable, live-
          updating stream of discrete items (same category of widget as a
          social feed), not role="list" (static) or a bare div. */}
      <ul
        role="feed"
        aria-label="Daftar notifikasi"
        aria-busy={isValidating}
        className="divide-y-0"
      >
        {notifications.map((notification) => (
          <NotificationRowV2
            key={notification.id}
            notification={notification}
            selected={selected.has(notification.id)}
            onToggleSelect={() => onToggleSelect(notification.id)}
            onOpenThread={onOpenThread}
            onAfterAction={onAfterAction}
            onMarkRead={() => onMarkRead(notification.id)}
          />
        ))}
      </ul>

      {hasMore && (
        <>
          <LoadMoreSentinel onIntersect={onLoadMore} disabled={isValidating} />
          <div className="flex justify-center p-4">
            <Button size="sm" variant="outline" disabled={isValidating} onClick={onLoadMore}>
              {isValidating ? 'Memuat...' : 'Muat lebih banyak'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
