'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Nav } from '@/components/Nav';
import { NotificationBulkToolbar } from '@/components/notifications/NotificationBulkToolbar';
import { NotificationFilterBar } from '@/components/notifications/NotificationFilterBar';
import { NotificationListV2 } from '@/components/notifications/NotificationListV2';
import { NotificationPreferencesPanelV2 } from '@/components/notifications/NotificationPreferencesPanelV2';
import { NotificationSearchInput } from '@/components/notifications/NotificationSearchInput';
import { NotificationThreadPanel } from '@/components/notifications/NotificationThreadPanel';
import { markNotificationsReadV2 } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useNotificationCenter } from '@/lib/useNotificationCenter';

// Notification Center v2 Phase 4 (Realtime & Frontend Integration) - the
// full-page Notification Center, additive alongside the existing
// NotificationBell dropdown (untouched, still reads V1). Modeled on
// app/library/page.tsx's own client-only SWR page shape (checkingAuth/!user
// guard, Nav, mx-auto max-w-6xl container) - no existing SSR data-fetching
// to preserve parity with, same as that page's own precedent.
export default function NotificationsPage() {
  const { user, checkingAuth, logout } = useAuth();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const center = useNotificationCenter();

  async function handleMarkRead(id: string) {
    await markNotificationsReadV2([id]);
    await center.refresh();
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Notifikasi
          </h1>
          {center.unreadCount > 0 && (
            <Badge variant="default" aria-label={`${center.unreadCount} belum dibaca`}>
              {center.unreadCount > 99 ? '99+' : center.unreadCount}
            </Badge>
          )}
        </div>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Semua notifikasi dan progres pemrosesan video Anda, real-time.
          {!center.connected && (
            <span className="ml-1 text-warning">(mode polling - koneksi real-time terputus)</span>
          )}
        </p>

        {/* Screen-reader-only live region - announces what actually changed
            on an SSE-driven update (see useNotificationCenter's diffing),
            never on plain pagination/filter changes. aria-live="polite" so
            it never interrupts whatever the user is currently doing. */}
        <div role="status" aria-live="polite" className="sr-only">
          {center.announcement}
        </div>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat notifikasi.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            <div className="mt-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="sm:max-w-xs sm:flex-1">
                  <NotificationSearchInput
                    value={center.filters.q}
                    onChange={(q) => center.updateFilters({ q })}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {center.unreadCount > 0 && (
                    <Button size="sm" variant="ghost" onClick={center.markAllRead}>
                      Tandai semua dibaca
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setPreferencesOpen(true)}>
                    Pengaturan
                  </Button>
                </div>
              </div>

              <NotificationFilterBar filters={center.filters} onChange={center.updateFilters} />

              <NotificationBulkToolbar
                selectedCount={center.selected.size}
                onMarkRead={center.bulkMarkRead}
                onArchive={center.bulkArchive}
                onDelete={center.bulkDelete}
                onClear={center.clearSelection}
              />

              {center.notifications.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={
                      center.selected.size === center.notifications.length
                        ? center.clearSelection
                        : center.selectAll
                    }
                    className="font-body text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {center.selected.size === center.notifications.length
                      ? 'Batalkan pilih semua'
                      : 'Pilih semua'}
                  </button>
                </div>
              )}

              <div className="rounded-md border border-border">
                <NotificationListV2
                  notifications={center.notifications}
                  isLoading={center.isLoading}
                  error={center.error}
                  hasMore={center.hasMore}
                  isValidating={center.isValidating}
                  onLoadMore={center.loadMore}
                  selected={center.selected}
                  onToggleSelect={center.toggleSelected}
                  onOpenThread={setActiveThreadId}
                  onAfterAction={center.refresh}
                  onMarkRead={handleMarkRead}
                  onRetry={center.refresh}
                />
              </div>
            </div>

            <NotificationThreadPanel
              threadId={activeThreadId}
              onClose={() => setActiveThreadId(null)}
              onAfterAction={center.refresh}
            />

            <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Pengaturan Notifikasi</DialogTitle>
                </DialogHeader>
                <NotificationPreferencesPanelV2 />
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </main>
  );
}
