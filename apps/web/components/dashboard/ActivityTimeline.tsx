'use client';

import { memo, useState } from 'react';
import type { ActivityEventDto, DashboardActivityDto } from '@speedora/shared';
import { CircleHelp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/dashboard';
import {
  ACTIVITY_ICONS,
  describeActivityEventDto,
  isKnownActivityEventType,
} from '@/lib/activity-events';
import { activityBucketLabel } from '@/lib/activity-time-buckets';
import { useActivityTimeline } from '@/lib/useActivityTimeline';
import { ActivityBulkToolbar } from './ActivityBulkToolbar';
import { ActivityClearAllDialog } from './ActivityClearAllDialog';
import { ActivityFilterBar } from './ActivityFilterBar';
import { ActivitySearchInput } from './ActivitySearchInput';

export interface ActivityTimelineProps {
  initialActivity?: DashboardActivityDto;
}

const UNKNOWN_ACTIVITY_LABEL = 'Unknown activity';

const ActivityRow = memo(function ActivityRow({
  event,
  selected,
  onToggleSelect,
  onDelete,
}: {
  event: ActivityEventDto;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  // Defense-in-depth only - see isKnownActivityEventType's own comment for
  // why this can't be replaced by the compile-time checks in
  // lib/activity-events.ts alone.
  if (!isKnownActivityEventType(event.type)) {
    console.warn(`[ActivityTimeline] unrecognized activity event type: ${event.type}`, event);
    return (
      <div className="flex items-center gap-3 p-3">
        <CircleHelp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="flex-1 font-body text-sm text-muted-foreground">{UNKNOWN_ACTIVITY_LABEL}</p>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    );
  }

  const Icon = ACTIVITY_ICONS[event.type];
  const { title, description } = describeActivityEventDto(event);

  return (
    <div className="group flex items-center gap-3 p-3">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Pilih aktivitas: ${title}`}
        className="h-4 w-4 shrink-0 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-body text-sm text-foreground">{title}</p>
        {description && (
          <p className="font-body text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatRelativeTime(event.createdAt)}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Hapus aktivitas ini"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
});

function ActivityLoadingSkeleton() {
  return (
    <div className="space-y-3 p-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 flex-1 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

// Fed by GET /dashboard/activity (v2) via useActivityTimeline - cursor
// pagination, time-bucket grouping, search/type filter, multi-select
// delete-one/delete-selected/clear-all, and a lightweight polling-based
// "new activity" banner. `initialActivity` seeds the SSR-fetched first page
// for a zero-flash first paint (see useActivityTimeline's own comment on
// why seeding is gated to default filters only).
export function ActivityTimeline({ initialActivity }: ActivityTimelineProps = {}) {
  const {
    filters,
    updateFilters,
    grouped,
    events,
    isLoading,
    error,
    hasMore,
    loadMore,
    selected,
    toggleSelected,
    clearSelection,
    hasNewActivity,
    showNewActivity,
    deleteOne,
    deleteSelected,
    deleteAll,
  } = useActivityTimeline({ initialActivity });
  const [clearAllOpen, setClearAllOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ActivitySearchInput value={filters.q} onChange={(q) => updateFilters({ q })} />
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => setClearAllOpen(true)}
        >
          Hapus Semua
        </Button>
      </div>

      <ActivityFilterBar value={filters.type} onChange={(type) => updateFilters({ type })} />

      <ActivityBulkToolbar
        selectedCount={selected.size}
        onDelete={() => void deleteSelected()}
        onClear={clearSelection}
      />

      {hasNewActivity && (
        <div className="flex items-center justify-between rounded-md border border-primary bg-primary-surface px-3 py-2">
          <span className="font-body text-sm text-foreground">Aktivitas baru tersedia</span>
          <Button size="sm" variant="outline" onClick={() => void showNewActivity()}>
            Tampilkan
          </Button>
        </div>
      )}

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive-surface px-4 py-3"
        >
          <p className="flex-1 font-body text-sm text-foreground">
            Tidak dapat memuat aktivitas.
          </p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Coba Lagi
          </Button>
        </div>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <ActivityLoadingSkeleton />
          </CardContent>
        </Card>
      ) : events.length === 0 ? (
        <p className="font-body text-sm text-muted-foreground">Belum ada aktivitas.</p>
      ) : (
        <>
          {grouped.map((group) => (
            <Card key={group.bucket}>
              <div className="border-b border-border px-3 py-2">
                <h3 className="font-body text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {activityBucketLabel(group.bucket)}
                </h3>
              </div>
              <CardContent className="divide-y divide-border p-0">
                {group.events.map((event) => (
                  <ActivityRow
                    key={event.id}
                    event={event}
                    selected={selected.has(event.id)}
                    onToggleSelect={() => toggleSelected(event.id)}
                    onDelete={() => void deleteOne(event.id)}
                  />
                ))}
              </CardContent>
            </Card>
          ))}

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore}>
                Muat lebih banyak
              </Button>
            </div>
          )}
        </>
      )}

      <ActivityClearAllDialog
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        onConfirm={deleteAll}
      />
    </div>
  );
}
