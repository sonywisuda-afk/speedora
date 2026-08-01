'use client';

import type { VideoHistoryRow as VideoHistoryRowDto } from '@speedora/shared';
import Link from 'next/link';
import { ScoreGauge } from '@/components/ScoreGauge';
import { Badge } from '@/components/ui/badge';
import { formatDuration, formatRelativeTime } from '@/lib/dashboard';
import { videoStatusBadge } from '@/lib/analytics';

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-success/40 text-success',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-destructive/40 text-destructive',
};

export function VideoHistoryRow({ video }: { video: VideoHistoryRowDto }) {
  const badge = videoStatusBadge(video.status);
  // Same "edit needs at least one clip" gate DashboardClient already uses
  // for its own "Edit Timeline" link - a pre-clip video routes to Review
  // instead, which has no such precondition.
  const href = video.clipCount > 0 ? `/videos/${video.id}/edit` : `/videos/${video.id}/review`;

  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted p-4">
      <div className="flex min-w-0 items-center gap-4">
        {video.topClipScore !== null ? (
          <ScoreGauge score={video.topClipScore} size={32} />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center font-mono text-xs text-muted-foreground">
            —
          </div>
        )}
        <div className="min-w-0">
          <Link href={href} className="truncate font-body text-sm font-medium text-foreground hover:underline">
            {video.title ?? 'Video Tanpa Judul'}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
              {badge.label}
            </Badge>
            <span
              className="font-mono text-xs text-muted-foreground"
              title={new Date(video.createdAt).toLocaleString()}
            >
              {formatRelativeTime(video.createdAt)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {video.clipCount} klip
            </span>
          </div>
        </div>
      </div>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatDuration(video.processingTimeSeconds)}
      </span>
    </li>
  );
}
