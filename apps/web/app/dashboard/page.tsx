import Link from 'next/link';
import { Suspense } from 'react';
import { DashboardClient } from '@/components/dashboard/DashboardClient';
import { DashboardSummary } from '@/components/dashboard/DashboardSummary';
import { Skeleton } from '@/components/ui/skeleton';
import { getServerUser, getServerVideos } from '@/lib/api.server';

const DEFAULT_LIMIT = 20;

function SummarySkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-32" />
    </div>
  );
}

// Product Experience performance pass (Dashboard <1s) - a Server Component
// now, rather than a fully client-rendered page that only started fetching
// after mounting. Auth + the primary video list are fetched server-side
// (lib/api.server.ts, forwarding the httpOnly session cookie via
// next/headers) so the first HTML response already contains real content;
// DashboardClient.tsx picks up from there (client polling/mutations, seeded
// with this data instead of starting from `null`). Stats/Activity are
// streamed in separately via <Suspense> so they never block the video list
// from painting - see DashboardSummary.tsx.
export default async function DashboardPage() {
  const user = await getServerUser();

  if (!user) {
    return (
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Speedora
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Riwayat video dan klip kamu.
          </p>
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat video kamu.
          </p>
        </div>
      </main>
    );
  }

  const { videos, nextCursor } = await getServerVideos({ limit: DEFAULT_LIMIT });

  return (
    <DashboardClient user={user} initialVideos={videos} initialNextCursor={nextCursor}>
      <Suspense fallback={<SummarySkeleton />}>
        <DashboardSummary />
      </Suspense>
    </DashboardClient>
  );
}
