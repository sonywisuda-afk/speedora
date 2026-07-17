'use client';

import { Bell } from 'lucide-react';
import { useRef, useState } from 'react';
import useSWR from 'swr';
import type { NotificationDto } from '@speedora/shared';
import {
  getNotificationPreferences,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelativeTime } from '@/lib/dashboard';
import { NOTIFICATION_ICONS, notificationTone } from '@/lib/notification-definitions';
import { toast } from '@/lib/toast-store';
import { useNotificationStream } from '@/lib/useNotificationStream';
import { NotificationPreferencesTab } from './NotificationPreferencesTab';

const LIST_LIMIT = 20;
// Milestone 04c - full cadence until SSE is confirmed live, relaxed once it
// is (a real safety net, not "poll at today's speed forever regardless" -
// that would defeat the point of adding push delivery). Speeds back up the
// instant the SSE connection drops (EventSource.onerror -> connected: false).
const LIST_POLL_MS_ACTIVE = 15000;
const LIST_POLL_MS_SSE = 120000;
const UNREAD_POLL_MS_ACTIVE = 20000;
const UNREAD_POLL_MS_SSE = 120000;

// Notification Center Sprint 4A - reuses the Dialog primitive (bell +
// dropdown), same shape as ExportCenterDialog. The list poll runs
// unconditionally (not gated by `open`, unlike ExportTypeRow's idiom) -
// toasts must fire even while the dialog is closed, so the dialog just
// reads from whatever this hook already has cached.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const lastSeenCreatedAt = useRef<string | null>(null);
  const seeded = useRef(false);
  // Milestone 04c - useNotificationStream's onEvent callback needs
  // mutateUnread/mutateList, which don't exist until after the useSWR calls
  // below run; a ref sidesteps the ordering problem (the ref is populated
  // after those hooks return, read only when the SSE hook later fires).
  const mutateRef = useRef<{ unread: () => void; list: () => void }>({
    unread: () => {},
    list: () => {},
  });

  const { connected } = useNotificationStream(() => {
    mutateRef.current.unread();
    mutateRef.current.list();
  });

  const { data: unread, mutate: mutateUnread } = useSWR(
    'notifications-unread-count',
    getUnreadNotificationCount,
    { refreshInterval: connected ? UNREAD_POLL_MS_SSE : UNREAD_POLL_MS_ACTIVE },
  );

  // Sprint 4B - no aggressive refreshInterval; preferences change rarely,
  // default SWR revalidate-on-focus is enough. Kept as its own hook (not
  // folded into the list poll below) so every 15s list refresh doesn't also
  // pay for a preferences round trip.
  const { data: preferences } = useSWR('notification-preferences', getNotificationPreferences);

  const { data: list, mutate: mutateList } = useSWR(
    'notifications-list',
    () => getNotifications(LIST_LIMIT),
    {
      refreshInterval: connected ? LIST_POLL_MS_SSE : LIST_POLL_MS_ACTIVE,
      onSuccess: (data) => {
        if (!seeded.current) {
          // First fetch just establishes the baseline - toasting every
          // pre-existing unread item on page load would be a toast storm,
          // not a notification.
          seeded.current = true;
          lastSeenCreatedAt.current = data.notifications[0]?.createdAt ?? null;
          return;
        }
        const newest = data.notifications.filter(
          (n) => !lastSeenCreatedAt.current || n.createdAt > lastSeenCreatedAt.current,
        );
        for (const n of newest.slice().reverse()) {
          const toastEnabled = preferences?.preferences.find((p) => p.type === n.type)?.toast ?? true;
          if (toastEnabled) {
            toast({ title: n.title, description: n.body, tone: notificationTone(n.type) });
          }
        }
        if (data.notifications[0]) {
          lastSeenCreatedAt.current = data.notifications[0].createdAt;
        }
      },
    },
  );

  mutateRef.current = { unread: mutateUnread, list: mutateList };

  async function handleMarkRead(notification: NotificationDto) {
    if (notification.readAt) return;
    await markNotificationRead(notification.id);
    mutateList();
    mutateUnread();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    mutateList();
    mutateUnread();
  }

  const count = unread?.count ?? 0;
  const notifications = list?.notifications ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="relative rounded-md p-1.5 text-muted-foreground hover:bg-slate-panel/60 hover:text-foreground"
          aria-label="Notifikasi"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {count > 0 && (
            <Badge
              variant="default"
              className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 py-0 text-[10px] leading-none"
            >
              {count > 99 ? '99+' : count}
            </Badge>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Notifikasi</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="notifikasi">
          <TabsList>
            <TabsTrigger value="notifikasi">Notifikasi</TabsTrigger>
            <TabsTrigger value="pengaturan">Pengaturan</TabsTrigger>
          </TabsList>
          <TabsContent value="notifikasi">
            <div className="mb-2 flex items-center justify-end">
              {notifications.some((n) => !n.readAt) && (
                <Button size="sm" variant="ghost" onClick={handleMarkAllRead}>
                  Tandai semua dibaca
                </Button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className="font-body text-sm text-muted-foreground">Belum ada notifikasi.</p>
            ) : (
              <div className="max-h-96 divide-y divide-border overflow-y-auto">
                {notifications.map((notification) => {
                  const Icon = NOTIFICATION_ICONS[notification.type];
                  return (
                    <button
                      key={notification.id}
                      onClick={() => handleMarkRead(notification)}
                      className={`flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-slate-panel/60 ${
                        notification.readAt ? 'opacity-60' : ''
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-chrome" aria-hidden="true" />
                      <div className="flex-1">
                        <p className="font-body text-sm text-foreground">{notification.title}</p>
                        <p className="font-body text-xs text-muted-foreground">
                          {notification.body}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </TabsContent>
          <TabsContent value="pengaturan">
            <NotificationPreferencesTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
