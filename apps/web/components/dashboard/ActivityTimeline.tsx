import { memo } from 'react';
import type { ActivityEventDto } from '@speedora/shared';
import { CircleHelp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/dashboard';
import {
  ACTIVITY_ICONS,
  describeActivityEvent,
  isKnownActivityEventType,
} from '@/lib/activity-events';

export interface ActivityTimelineProps {
  events: ActivityEventDto[];
}

const UNKNOWN_ACTIVITY_LABEL = 'Unknown activity';

const ActivityRow = memo(function ActivityRow({ event }: { event: ActivityEventDto }) {
  // Defense-in-depth only - see isKnownActivityEventType's own comment for
  // why this can't be replaced by the compile-time checks in
  // lib/activity-events.ts alone.
  if (!isKnownActivityEventType(event.type)) {
    console.warn(`[ActivityTimeline] unrecognized activity event type: ${event.type}`, event);
    return (
      <div className="flex items-center gap-3 p-3">
        <CircleHelp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="flex-1 font-body text-sm text-muted-foreground">{UNKNOWN_ACTIVITY_LABEL}</p>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    );
  }

  const Icon = ACTIVITY_ICONS[event.type];
  return (
    <div className="flex items-center gap-3 p-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="flex-1 font-body text-sm text-foreground">{describeActivityEvent(event)}</p>
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
