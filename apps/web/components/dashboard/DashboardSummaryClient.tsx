'use client';

import type {
  DashboardActivityDto,
  DashboardExportsDto,
  DashboardStatsDto,
} from '@speedora/shared';
import { AlertTriangle } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { getDashboardExports, getDashboardStats } from '@/lib/api';
import { ActivityTimeline } from './ActivityTimeline';
import { ExportActivityPanel } from './ExportActivityPanel';
import { StatisticsRow } from './StatisticsRow';

export interface DashboardSummaryClientProps {
  initialStats: DashboardStatsDto;
  initialActivity: DashboardActivityDto;
  initialExports: DashboardExportsDto;
}

// Heavier aggregate queries than the video list, polled on a longer interval
// - unchanged from the original page.tsx's own DASHBOARD_SUMMARY_POLL_INTERVAL_MS
// reasoning, just now via SWR instead of a hand-rolled useEffect/setInterval,
// seeded with fallbackData from DashboardSummary.tsx's server-side fetch (see
// lib/api.server.ts) so this never needs a client round trip for its first
// render.
const POLL_INTERVAL_MS = 10000;

// Phase F (performance hardening) - a fetch failure for any of the three
// sections below used to render nothing at all, silently (only `data` was
// ever destructured from useSWR, never `error`). Same error+retry posture
// NotificationListV2 already uses elsewhere in this app, scaled down to one
// line since these are dashboard summary tiles, not a full list view.
function SectionError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive-surface px-4 py-3"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="flex-1 font-body text-sm text-foreground">Gagal memuat {label}.</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Coba Lagi
      </Button>
    </div>
  );
}

export function DashboardSummaryClient({
  initialStats,
  initialActivity,
  initialExports,
}: DashboardSummaryClientProps) {
  const {
    data: stats,
    error: statsError,
    mutate: mutateStats,
  } = useSWR('dashboard-stats', getDashboardStats, {
    fallbackData: initialStats,
    refreshInterval: POLL_INTERVAL_MS,
  });
  const {
    data: exports,
    error: exportsError,
    mutate: mutateExports,
  } = useSWR('dashboard-exports', getDashboardExports, {
    fallbackData: initialExports,
    refreshInterval: POLL_INTERVAL_MS,
  });

  return (
    <>
      {statsError ? (
        <SectionError label="statistik" onRetry={() => mutateStats()} />
      ) : (
        stats && <StatisticsRow stats={stats} />
      )}
      <ActivityTimeline initialActivity={initialActivity} />
      {exportsError ? (
        <SectionError label="aktivitas export" onRetry={() => mutateExports()} />
      ) : (
        exports && <ExportActivityPanel exports={exports} />
      )}
    </>
  );
}
