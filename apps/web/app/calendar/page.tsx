'use client';

import { PublishStatus } from '@speedora/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getWorkspaceCalendar } from '@/lib/api';
import { buildMonthGrid, dateKey, groupEntriesByDate, parseDateKey } from '@/lib/calendar';
import { platformIcon, platformLabel } from '@/lib/platform-metadata';
import { PUBLISH_STATUS_LABELS } from '@/lib/scheduling';
import { useAuth } from '@/lib/useAuth';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Dot color per PublishStatus - published/failed get a clear success/error
// tint, everything still in flight (SCHEDULED/QUEUED/PUBLISHING) stays
// neutral since none of them is actionably different from a calendar
// glance.
const STATUS_TONE: Partial<Record<PublishStatus, string>> = {
  [PublishStatus.PUBLISHED]: 'bg-emerald-500',
  [PublishStatus.FAILED]: 'bg-rose-500',
};
const DEFAULT_TONE = 'bg-slate-400';

// Publishing Expansion Phase 6D (Calendar view) - a read-only rollup of the
// workspace's PublishRecords (GET /workspaces/:id/calendar). No
// drag-to-reschedule, no create-from-calendar - both already exist via the
// Publish dialog (Phase 6C) and Campaign/Schedule pages; this is purely a
// visualization, same "list view is fine, calendar is an enhancement"
// framing the user deferred this feature under originally.
export default function CalendarPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const rangeStart = weeks[0][0];
  const lastVisibleDay = weeks[weeks.length - 1][6];
  // The API's range is half-open [start, end) - the grid's last visible day
  // is inclusive, so the request's `end` is one day past it.
  const rangeEnd = new Date(
    lastVisibleDay.getFullYear(),
    lastVisibleDay.getMonth(),
    lastVisibleDay.getDate() + 1,
  );

  const { data, error, isLoading } = useSWR(
    user && activeWorkspaceId ? ['calendar', activeWorkspaceId, year, month] : null,
    () =>
      getWorkspaceCalendar(
        activeWorkspaceId as string,
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
      ),
  );

  const grouped = useMemo(() => groupEntriesByDate(data?.entries ?? []), [data]);
  const todayKey = dateKey(now);
  const selectedEntries = selectedDate ? (grouped.get(selectedDate) ?? []) : [];

  function goToPrevMonth() {
    setSelectedDate(null);
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    setSelectedDate(null);
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function goToToday() {
    setSelectedDate(null);
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">Calendar</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          A read-only view of scheduled and published content across the workspace.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat kalender.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {!activeWorkspaceId && (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Pilih workspace terlebih dahulu (lihat pemilih workspace di navigasi).
              </p>
            )}
            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat kalender'}
              </p>
            )}

            {activeWorkspaceId && (
              <>
                <div className="mt-6 flex items-center justify-between gap-2">
                  <p className="font-display text-lg uppercase tracking-wide text-foreground">
                    {new Date(year, month, 1).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={goToPrevMonth} aria-label="Previous month">
                      ←
                    </Button>
                    <Button size="sm" variant="outline" onClick={goToToday}>
                      Today
                    </Button>
                    <Button size="sm" variant="outline" onClick={goToNextMonth} aria-label="Next month">
                      →
                    </Button>
                  </div>
                </div>

                {!isLoading && (
                  <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
                    {DAY_HEADERS.map((label) => (
                      <div
                        key={label}
                        className="bg-slate-panel px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                      >
                        {label}
                      </div>
                    ))}
                    {weeks.flat().map((day) => {
                      const key = dateKey(day);
                      const entries = grouped.get(key) ?? [];
                      const inMonth = day.getMonth() === month;
                      const isToday = key === todayKey;
                      const isSelected = key === selectedDate;
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={entries.length === 0}
                          onClick={() => setSelectedDate(isSelected ? null : key)}
                          className={cn(
                            'flex min-h-20 flex-col items-start gap-1 bg-background p-1.5 text-left transition-colors disabled:cursor-default',
                            !inMonth && 'opacity-40',
                            entries.length > 0 && 'hover:bg-slate-panel/60',
                            isSelected && 'ring-2 ring-inset ring-signal-pink',
                            isToday && 'bg-slate-panel',
                          )}
                        >
                          <span
                            className={cn(
                              'font-mono text-xs',
                              isToday ? 'font-bold text-signal-cyan' : 'text-muted-foreground',
                            )}
                          >
                            {day.getDate()}
                          </span>
                          {entries.length > 0 && (
                            <div className="flex flex-wrap items-center gap-0.5">
                              {entries.slice(0, 3).map((entry) => {
                                const Icon = platformIcon(entry.platform);
                                return (
                                  <span
                                    key={entry.id}
                                    className={cn(
                                      'flex h-4 w-4 items-center justify-center rounded-full',
                                      STATUS_TONE[entry.status] ?? DEFAULT_TONE,
                                    )}
                                  >
                                    <Icon className="h-2.5 w-2.5 text-bay-black" aria-hidden="true" />
                                  </span>
                                );
                              })}
                              {entries.length > 3 && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  +{entries.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedDate && (
                  <div className="mt-4 space-y-2">
                    <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                      {parseDateKey(selectedDate).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                    {selectedEntries.map((entry) => {
                      const Icon = platformIcon(entry.platform);
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-slate-panel p-3"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-body text-sm text-foreground">
                                {entry.clipHookText ?? 'Untitled clip'}
                              </p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {platformLabel(entry.platform)}
                                {entry.campaignName && ` · ${entry.campaignName}`}
                                {' · '}
                                {new Date(entry.date).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </p>
                              {entry.status === PublishStatus.FAILED && entry.errorMessage && (
                                <p className="font-mono text-xs text-destructive">
                                  {entry.errorMessage}
                                </p>
                              )}
                            </div>
                          </div>
                          <Badge variant="outline" className="shrink-0">
                            {PUBLISH_STATUS_LABELS[entry.status]}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
