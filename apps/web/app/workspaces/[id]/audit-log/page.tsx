'use client';

import type { AuditLogEntryDto } from '@speedora/shared';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Nav } from '@/components/Nav';
import { formatRelativeTime } from '@/lib/dashboard';
import { getWorkspace, listWorkspaceAuditLog } from '@/lib/api';
import { getAuditActionLabel } from '@/lib/audit-log-labels';
import { useAuth } from '@/lib/useAuth';

const DEFAULT_LIMIT = 30;

// Sprint 5F (Audit Log) - ADMIN+-only, same "check server-enforced role,
// show a forbidden state client-side" pattern as /ops/ai. A workspace-level
// page (not video-scoped, unlike Comments/Approval/Version History), so it
// lives under its own /workspaces/[id]/ route rather than the Timeline
// Editor.
export default function AuditLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, checkingAuth, logout } = useAuth();
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      try {
        const workspace = await getWorkspace(id);
        if (cancelled) return;
        if (workspace.role !== 'ADMIN' && workspace.role !== 'OWNER') {
          setForbidden(true);
          return;
        }
        setWorkspaceName(workspace.name);

        const page = await listWorkspaceAuditLog(id, { limit: DEFAULT_LIMIT });
        if (cancelled) return;
        setEntries(page.entries);
        setNextCursor(page.nextCursor);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat audit log');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user, id]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listWorkspaceAuditLog(id, {
        cursor: nextCursor,
        limit: DEFAULT_LIMIT,
      });
      setEntries((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">Audit Log</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          {workspaceName ? `Riwayat aktivitas governance untuk "${workspaceName}".` : 'Memuat...'}
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat audit log.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {forbidden && (
              <p className="mt-8 font-body text-sm text-destructive">
                Halaman ini hanya untuk Admin/Owner workspace.
              </p>
            )}
            {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

            {!forbidden && !error && (
              <div className="mt-6 space-y-2">
                {entries.length === 0 ? (
                  <p className="font-body text-sm text-muted-foreground">Belum ada aktivitas.</p>
                ) : (
                  entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-md border border-border bg-muted p-3 font-body text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {getAuditActionLabel(entry.action)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatRelativeTime(entry.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        oleh {entry.actorEmail} · {entry.targetType}
                        {entry.targetId ? ` (${entry.targetId})` : ''}
                      </p>
                      {entry.metadata && (
                        <p className="mt-1 font-mono text-xs text-chrome">
                          {JSON.stringify(entry.metadata)}
                        </p>
                      )}
                    </div>
                  ))
                )}
                {nextCursor && (
                  <div className="flex justify-center pt-2">
                    <Button size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>
                      {loadingMore ? 'Memuat...' : 'Load More'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
