import { Skeleton } from '@/components/ui/skeleton';

// Shown while page.tsx's own server-side fetch (auth + first video page) is
// in flight - Next.js's automatic loading.tsx convention for this route.
export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Speedora
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Riwayat video dan klip kamu.
          </p>
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    </main>
  );
}
