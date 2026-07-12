import { memo } from 'react';
import { ActivityEventType, type ActivityEventDto } from '@speedora/shared';
import { Download, Film, UploadCloud, UserPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/dashboard';

export interface ActivityTimelineProps {
  events: ActivityEventDto[];
}

const ICONS: Record<ActivityEventType, typeof UploadCloud> = {
  [ActivityEventType.VIDEO_UPLOADED]: UploadCloud,
  [ActivityEventType.CLIP_GENERATED]: Film,
  [ActivityEventType.CLIP_EXPORTED]: Download,
  [ActivityEventType.MEMBER_INVITED]: UserPlus,
};

function describe(event: ActivityEventDto): string {
  const title =
    typeof event.metadata?.title === 'string' ? event.metadata.title : 'video tanpa judul';
  switch (event.type) {
    case ActivityEventType.VIDEO_UPLOADED:
      return `Video diunggah: ${title}`;
    case ActivityEventType.CLIP_GENERATED:
      return 'Klip baru berhasil dibuat';
    case ActivityEventType.CLIP_EXPORTED:
      return 'Klip diunduh';
    case ActivityEventType.MEMBER_INVITED: {
      const email = typeof event.metadata?.email === 'string' ? event.metadata.email : '';
      return `Mengundang ${email}`;
    }
  }
}

const ActivityRow = memo(function ActivityRow({ event }: { event: ActivityEventDto }) {
  const Icon = ICONS[event.type];
  return (
    <div className="flex items-center gap-3 p-3">
      <Icon className="h-4 w-4 shrink-0 text-chrome" aria-hidden="true" />
      <p className="flex-1 font-body text-sm text-foreground">{describe(event)}</p>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatRelativeTime(event.createdAt)}
      </span>
    </div>
  );
});

// Fed by GET /dashboard/activity - a thin, no-JSX-logic read of
// ActivityEvent rows, newest first (server-sorted). One icon per event
// type, relative-time formatted (lib/dashboard.ts's formatRelativeTime, no
// date library anywhere in this app).
export function ActivityTimeline({ events }: ActivityTimelineProps) {
  if (events.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Belum ada aktivitas.</p>;
  }

  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {events.map((event) => (
          <ActivityRow key={event.id} event={event} />
        ))}
      </CardContent>
    </Card>
  );
}
