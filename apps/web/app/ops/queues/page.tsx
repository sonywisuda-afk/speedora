'use client';

import type { QueuesDto, WorkersHealthDto } from '@speedora/shared';
import { UserRole } from '@speedora/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { QueueMetricsTable } from '@/components/ops-queues/QueueMetricsTable';
import { WorkerHeartbeatTable } from '@/components/ops-queues/WorkerHeartbeatTable';
import { StatTile } from '@/components/analytics/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Nav } from '@/components/Nav';
import { getQueues, getWorkersHealth } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

// PR #44 (Queue & Worker Observability Dashboard) - the first of the
// Oracle Cloud Free hybrid roadmap's post-Fase-3 priorities (fix known
// findings -> add observability -> collect production metrics -> only then
// evaluate autoscaling against real data, not before). Deliberately does
// NOT add any scaling control - purely read-only visibility into what
// GET /queues and GET /workers/health already report.
//
// Restricted to the same non-CREATOR roles as /ops/ai, client-side only -
// see Nav.tsx's OPS_QUEUES_LINK comment and getQueues()'s own comment in
// lib/api.ts for why this is a UX boundary, not a security one: unlike
// /ops/ai/*, GET /queues/GET /workers/health are deliberately unauthenticated
// server-side (docs/monitoring.md), so there is no 403 to catch here.
const ALLOWED_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.AI_ENGINEER, UserRole.OPERATOR]);

export default function OpsQueuesPage() {
  const { user, checkingAuth, logout } = useAuth();
  const [queues, setQueues] = useState<QueuesDto | null>(null);
  const [workers, setWorkers] = useState<WorkersHealthDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return Promise.all([getQueues(), getWorkersHealth()])
      .then(([q, w]) => {
        setQueues(q);
        setWorkers(w);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat data queue/worker');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user || !ALLOWED_ROLES.has(user.role)) return;
    void load();
  }, [user, load]);

  const allowed = !!user && ALLOWED_ROLES.has(user.role);

  const queueEntries = queues ? Object.values(queues) : [];
  const totalWaiting = queueEntries.reduce((sum, q) => sum + q.waiting, 0);
  const totalActive = queueEntries.reduce((sum, q) => sum + q.active, 0);
  const elevatedFailureRate = queueEntries.filter(
    (q) => q.failureRate !== null && q.failureRate > 0.2,
  ).length;

  return (
    <main className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Queue &amp; Worker Observability — status antrean dan heartbeat worker secara langsung
          dari GET /queues dan GET /workers/health.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat dashboard ini.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {!allowed ? (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Halaman ini dibatasi untuk role ADMIN/AI_ENGINEER/OPERATOR. Akun kamu saat ini tidak
                memiliki akses.
              </p>
            ) : error ? (
              <div className="mt-4 space-y-3">
                <p className="font-body text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Coba Lagi
                </Button>
              </div>
            ) : (
              <div className="mt-4 space-y-6">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {queues && workers ? 'Data terbaru' : 'Memuat…'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void load()}
                    disabled={loading}
                  >
                    {loading ? 'Memuat…' : 'Refresh'}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <StatTile label="Queues" value={String(queueEntries.length)} />
                  <StatTile label="Workers Online" value={String(workers?.length ?? 0)} />
                  <StatTile label="Total Waiting" value={String(totalWaiting)} />
                  <StatTile label="Total Active" value={String(totalActive)} />
                  <StatTile
                    label="Failure Rate Tinggi"
                    value={String(elevatedFailureRate)}
                    caption="queue dengan failure rate > 20%"
                  />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Worker Heartbeat</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <WorkerHeartbeatTable workers={workers ?? []} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Queue Metrics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <QueueMetricsTable queues={queues ?? {}} />
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
