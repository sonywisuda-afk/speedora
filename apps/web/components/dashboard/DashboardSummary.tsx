import { getServerDashboardActivity, getServerDashboardStats } from '@/lib/api.server';
import { DashboardSummaryClient } from './DashboardSummaryClient';

// Async Server Component, meant to be wrapped in <Suspense> by
// app/dashboard/page.tsx - lets the primary content (nav, search, video
// list) stream to the browser without waiting on these two heavier
// aggregate queries to resolve first.
export async function DashboardSummary() {
  const [stats, activity] = await Promise.all([
    getServerDashboardStats(),
    getServerDashboardActivity(),
  ]);

  return <DashboardSummaryClient initialStats={stats} initialActivity={activity} />;
}
