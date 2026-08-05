import {
  getServerDashboardActivity,
  getServerDashboardExports,
  getServerDashboardStats,
} from '@/lib/api.server';
import { ACTIVITY_PAGE_LIMIT } from '@/lib/activity-events';
import { DashboardSummaryClient } from './DashboardSummaryClient';

// Async Server Component, meant to be wrapped in <Suspense> by
// app/dashboard/page.tsx - lets the primary content (nav, search, video
// list) stream to the browser without waiting on these heavier aggregate
// queries to resolve first.
export async function DashboardSummary() {
  const [stats, activity, exports] = await Promise.all([
    getServerDashboardStats(),
    getServerDashboardActivity(ACTIVITY_PAGE_LIMIT),
    getServerDashboardExports(),
  ]);

  return (
    <DashboardSummaryClient
      initialStats={stats}
      initialActivity={activity}
      initialExports={exports}
    />
  );
}
