'use client';

import type {
  DashboardActivityDto,
  DashboardExportsDto,
  DashboardStatsDto,
} from '@speedora/shared';
import useSWR from 'swr';
import { getDashboardActivity, getDashboardExports, getDashboardStats } from '@/lib/api';
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

export function DashboardSummaryClient({
  initialStats,
  initialActivity,
  initialExports,
}: DashboardSummaryClientProps) {
  const { data: stats } = useSWR('dashboard-stats', getDashboardStats, {
    fallbackData: initialStats,
    refreshInterval: POLL_INTERVAL_MS,
  });
  const { data: activity } = useSWR('dashboard-activity', () => getDashboardActivity(), {
    fallbackData: initialActivity,
    refreshInterval: POLL_INTERVAL_MS,
  });
  const { data: exports } = useSWR('dashboard-exports', getDashboardExports, {
    fallbackData: initialExports,
    refreshInterval: POLL_INTERVAL_MS,
  });

  return (
    <>
      {stats && <StatisticsRow stats={stats} />}
      {activity && <ActivityTimeline events={activity.events} />}
      {exports && <ExportActivityPanel exports={exports} />}
    </>
  );
}
