'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import { CreateRecurringScheduleDialog } from '@/components/scheduling/CreateRecurringScheduleDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  deleteRecurringSchedule,
  listRecurringSchedules,
  listSocialAccounts,
  updateRecurringSchedule,
} from '@/lib/api';
import { platformIcon, platformLabel } from '@/lib/platform-metadata';
import { DAY_LABELS } from '@/lib/timezones';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

// Phase 6 (Scheduling), Frontend part B - RecurringSchedule CRUD list. Flat
// /schedules route, same useWorkspaceStore convention as /campaigns.
export default function SchedulesPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    user && activeWorkspaceId ? ['recurring-schedules', activeWorkspaceId] : null,
    () => listRecurringSchedules(activeWorkspaceId as string),
  );
  const { data: accounts } = useSWR(user ? 'social-accounts' : null, () => listSocialAccounts());

  async function handleToggleActive(id: string, active: boolean) {
    setBusyId(id);
    try {
      await updateRecurringSchedule(id, { active });
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await deleteRecurringSchedule(id);
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
              Recurring Schedules
            </h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              Automatic recurring publish time slots - queue clips against a schedule from the
              Publish dialog.
            </p>
          </div>
          {user && activeWorkspaceId && (
            <CreateRecurringScheduleDialog
              workspaceId={activeWorkspaceId}
              accounts={accounts ?? []}
              onCreated={() => mutate()}
            />
          )}
        </div>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat schedule.
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
                {error instanceof Error ? error.message : 'Gagal memuat schedule'}
              </p>
            )}

            {activeWorkspaceId &&
              !isLoading &&
              (data?.recurringSchedules.length === 0 ? (
                <p className="mt-8 font-body text-sm text-muted-foreground">
                  Belum ada recurring schedule.
                </p>
              ) : (
                <ul className="mt-6 space-y-3">
                  {data?.recurringSchedules.map((schedule) => {
                    const Icon = platformIcon(schedule.platform);
                    return (
                      <li
                        key={schedule.id}
                        className="flex items-center justify-between gap-4 rounded-lg border border-border bg-slate-panel p-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Icon
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="font-body text-sm font-medium text-foreground">
                              {schedule.name}
                            </span>
                            <Badge variant="outline">{platformLabel(schedule.platform)}</Badge>
                            {!schedule.active && <Badge variant="muted">Paused</Badge>}
                          </div>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {schedule.daysOfWeek
                              .slice()
                              .sort((a, b) => a - b)
                              .map((d) => DAY_LABELS[d])
                              .join(', ')}{' '}
                            at {schedule.timeOfDay} ({schedule.timezone})
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === schedule.id}
                            onClick={() => handleToggleActive(schedule.id, !schedule.active)}
                          >
                            {schedule.active ? 'Pause' : 'Resume'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === schedule.id}
                            onClick={() => handleDelete(schedule.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            Delete
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </>
        )}
      </div>
    </main>
  );
}
