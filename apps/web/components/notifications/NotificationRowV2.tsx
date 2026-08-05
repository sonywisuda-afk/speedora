'use client';

import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { NotificationActionType, type NotificationV2Dto } from '@speedora/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { archiveNotificationsV2, retryVideo } from '@/lib/api';
import { formatRelativeTime } from '@/lib/dashboard';
import {
  getNotificationIconV2,
  getPriorityDefinition,
  getThreadStatusDefinition,
} from '@/lib/notification-definitions-v2';
import { cn } from '@/lib/utils';

const ACTION_LABELS: Record<NotificationActionType, string> = {
  [NotificationActionType.RETRY]: 'Coba Lagi',
  [NotificationActionType.OPEN_VIDEO]: 'Buka Video',
  [NotificationActionType.OPEN_CLIP]: 'Buka Klip',
  [NotificationActionType.PUBLISH]: 'Publikasikan',
  [NotificationActionType.VIEW_ANALYTICS]: 'Lihat Analitik',
  [NotificationActionType.VIEW_LOGS]: 'Detail Teknis',
  [NotificationActionType.DISMISS]: 'Abaikan',
};

function actionHref(
  action: NotificationActionType,
  notification: NotificationV2Dto,
): string | null {
  if (action === NotificationActionType.VIEW_ANALYTICS && notification.videoId) {
    return `/videos/${notification.videoId}/performance`;
  }
  if (
    (action === NotificationActionType.OPEN_VIDEO ||
      action === NotificationActionType.OPEN_CLIP ||
      action === NotificationActionType.PUBLISH) &&
    notification.deepLink
  ) {
    return notification.deepLink;
  }
  return null;
}

export function NotificationRowV2({
  notification,
  selected,
  onToggleSelect,
  onOpenThread,
  onAfterAction,
  onMarkRead,
}: {
  notification: NotificationV2Dto;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenThread: (threadId: string) => void;
  onAfterAction: () => void;
  onMarkRead: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);

  const Icon = getNotificationIconV2(notification.type);
  const priority = getPriorityDefinition(notification.priority);
  const PriorityIcon = priority.icon;
  const isUnread = !notification.readAt;

  function handleOpen() {
    if (isUnread) onMarkRead();
    if (notification.thread) {
      onOpenThread(notification.thread.id);
    }
  }

  async function handleRetry() {
    if (!notification.videoId || busy) return;
    setBusy(true);
    try {
      await retryVideo(notification.videoId);
      onAfterAction();
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await archiveNotificationsV2([notification.id]);
      onAfterAction();
    } finally {
      setBusy(false);
    }
  }

  const metadataEntries = notification.metadata ? Object.entries(notification.metadata) : [];
  const titleId = `notification-title-${notification.id}`;

  return (
    // role="article" + aria-labelledby - the WAI-ARIA feed pattern's
    // per-item shape (parent list has role="feed", see NotificationListV2),
    // so a screen reader can jump row-to-row by "article" landmark instead
    // of reading the whole feed linearly.
    <li
      role="article"
      aria-labelledby={titleId}
      className={cn(
        'flex gap-3 border-b border-border p-3 transition-colors',
        isUnread ? 'bg-primary-surface/30' : 'bg-transparent',
        selected && 'ring-1 ring-inset ring-primary',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Pilih notifikasi: ${notification.title}`}
        className="mt-1 h-4 w-4 shrink-0 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {/* eslint-disable-next-line react-hooks/static-components -- Icon is a
          stable module-level component reference from a pure lookup table
          (getNotificationIconV2), not a component created during render;
          the rule can't see through the function-call indirection. */}
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-chrome" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {notification.thread ? (
            <button
              id={titleId}
              type="button"
              onClick={handleOpen}
              className="font-body text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {notification.title}
              {!notification.readAt && <span className="sr-only"> (belum dibaca)</span>}
            </button>
          ) : (
            <button
              id={titleId}
              type="button"
              onClick={handleOpen}
              className="text-left font-body text-sm font-medium text-foreground"
            >
              {notification.title}
              {!notification.readAt && <span className="sr-only"> (belum dibaca)</span>}
            </button>
          )}

          {isUnread && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              title="Belum dibaca"
            />
          )}

          <Badge variant={priority.badgeVariant} className="gap-1">
            <PriorityIcon className="h-3 w-3" aria-hidden="true" />
            {priority.label}
          </Badge>

          {notification.thread &&
            (() => {
              const threadDef = getThreadStatusDefinition(notification.thread.status);
              const ThreadIcon = threadDef.icon;
              return (
                <Badge variant={threadDef.badgeVariant} className="gap-1">
                  <ThreadIcon
                    className={cn('h-3 w-3', threadDef.spin && 'animate-spin')}
                    aria-hidden="true"
                  />
                  {threadDef.label}
                </Badge>
              );
            })()}

          {notification.group && notification.group.occurrenceCount > 1 && (
            <Badge variant="muted">×{notification.group.occurrenceCount}</Badge>
          )}
        </div>

        <p className="mt-0.5 font-body text-xs text-muted-foreground">{notification.body}</p>

        {typeof notification.metadata?.renderedClips === 'number' &&
          typeof notification.metadata?.totalClips === 'number' &&
          notification.metadata.totalClips > 0 && (
            <div
              className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.round(
                (100 * (notification.metadata.renderedClips as number)) /
                  (notification.metadata.totalClips as number),
              )}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progres rendering: ${notification.metadata.renderedClips} dari ${notification.metadata.totalClips} klip selesai`}
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{
                  width: `${Math.round(
                    (100 * (notification.metadata.renderedClips as number)) /
                      (notification.metadata.totalClips as number),
                  )}%`,
                }}
              />
            </div>
          )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {notification.actions.map((action) => {
            const href = actionHref(action, notification);
            if (href) {
              return (
                <Button key={action} asChild size="sm" variant="outline">
                  <Link href={href}>{ACTION_LABELS[action]}</Link>
                </Button>
              );
            }
            if (action === NotificationActionType.RETRY) {
              return (
                <Button
                  key={action}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={handleRetry}
                >
                  {ACTION_LABELS[action]}
                </Button>
              );
            }
            if (action === NotificationActionType.VIEW_LOGS) {
              return (
                <Button
                  key={action}
                  size="sm"
                  variant="ghost"
                  aria-expanded={showDetail}
                  onClick={() => setShowDetail((v) => !v)}
                >
                  {showDetail ? (
                    <ChevronUp className="mr-1 h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="mr-1 h-3 w-3" aria-hidden="true" />
                  )}
                  {ACTION_LABELS[action]}
                </Button>
              );
            }
            if (action === NotificationActionType.DISMISS) {
              return (
                <Button
                  key={action}
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={handleDismiss}
                >
                  {ACTION_LABELS[action]}
                </Button>
              );
            }
            return null;
          })}
        </div>

        {showDetail && metadataEntries.length > 0 && (
          <dl className="mt-2 space-y-1 rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
            {metadataEntries.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{key}:</dt>
                <dd className="break-all text-foreground">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <span
        className="shrink-0 font-mono text-xs text-muted-foreground"
        title={new Date(notification.updatedAt).toLocaleString()}
      >
        {formatRelativeTime(notification.updatedAt)}
      </span>
    </li>
  );
}
