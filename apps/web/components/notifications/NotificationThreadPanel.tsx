'use client';

import useSWR from 'swr';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { getNotificationThreadDetail, retryVideo } from '@/lib/api';
import { formatRelativeTime } from '@/lib/dashboard';
import {
  getThreadStatusDefinition,
  getTimelineStageStatusDefinition,
} from '@/lib/notification-definitions-v2';
import { cn } from '@/lib/utils';

// Notification Center v2 Phase 4 - the Smart Timeline view. Every stage
// rendered here comes straight from GET /notifications/v2/threads/:id's
// `timeline` (Phase 3's fetchPipelineTimeline, itself derived live from
// VideoStatusEvent - never fabricated). Radix Dialog (components/ui/dialog)
// gives this focus-trap + focus-return-on-close + Escape-to-close for free.
export function NotificationThreadPanel({
  threadId,
  onClose,
  onAfterAction,
}: {
  threadId: string | null;
  onClose: () => void;
  onAfterAction: () => void;
}) {
  const { data, error, isLoading, mutate } = useSWR(
    threadId ? ['notification-thread-detail', threadId] : null,
    ([, id]) => getNotificationThreadDetail(id),
  );

  async function handleRetry() {
    if (!data?.thread.videoId) return;
    await retryVideo(data.thread.videoId);
    await mutate();
    onAfterAction();
  }

  return (
    <Dialog open={threadId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div role="alert" className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <p className="font-body text-sm">Gagal memuat detail thread.</p>
          </div>
        )}

        {data && !isLoading && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle>{data.thread.title}</DialogTitle>
                {(() => {
                  const def = getThreadStatusDefinition(data.thread.status);
                  const Icon = def.icon;
                  return (
                    <Badge variant={def.badgeVariant} className="gap-1">
                      <Icon
                        className={cn('h-3 w-3', def.spin && 'animate-spin')}
                        aria-hidden="true"
                      />
                      {def.label}
                    </Badge>
                  );
                })()}
              </div>
              <DialogDescription>
                Terakhir diperbarui {formatRelativeTime(data.thread.lastActivityAt)}
              </DialogDescription>
            </DialogHeader>

            {data.timeline && (
              <ol className="space-y-3" aria-label="Timeline pemrosesan">
                {data.timeline.stages.map((stage) => {
                  const def = getTimelineStageStatusDefinition(stage.status);
                  const StageIcon = def.icon;
                  return (
                    <li key={stage.stage} className="flex gap-3">
                      <StageIcon
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          stage.status === 'done' && 'text-success',
                          stage.status === 'active' && 'text-info animate-spin',
                          stage.status === 'failed' && 'text-destructive',
                          stage.status === 'pending' && 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      />
                      <div className="flex-1">
                        <p className="font-body text-sm text-foreground">
                          {stage.label}
                          <span className="sr-only"> - {def.label}</span>
                        </p>
                        {stage.progressPercent != null && (
                          <div
                            className="mt-1 h-1.5 w-full max-w-[12rem] overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-valuenow={stage.progressPercent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${stage.label}: ${stage.progressPercent}%`}
                          >
                            <div
                              className="h-full bg-primary transition-[width]"
                              style={{ width: `${stage.progressPercent}%` }}
                            />
                          </div>
                        )}
                        {stage.detail && (
                          <p className="mt-0.5 font-body text-xs text-muted-foreground">
                            {stage.detail}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {data.timeline && data.timeline.failureHistory.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive-surface p-3">
                <p className="font-body text-xs font-medium text-foreground">
                  Riwayat kegagalan ({data.timeline.failureHistory.length})
                </p>
                <ul className="mt-1.5 space-y-1">
                  {data.timeline.failureHistory.map((entry, index) => (
                    <li key={index} className="font-body text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{entry.stage}</span>
                      {entry.reason ? `: ${entry.reason}` : ''} —{' '}
                      {formatRelativeTime(entry.occurredAt)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.thread.status === 'FAILED' && (
              <div className="flex justify-end">
                <Button size="sm" onClick={handleRetry}>
                  Coba Lagi
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
