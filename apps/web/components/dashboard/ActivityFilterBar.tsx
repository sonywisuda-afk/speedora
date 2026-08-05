'use client';

import { ActivityEventType } from '@speedora/shared';
import { Button } from '@/components/ui/button';
import { ACTIVITY_ICONS } from '@/lib/activity-events';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<ActivityEventType, string> = {
  [ActivityEventType.VIDEO_UPLOADED]: 'Upload',
  [ActivityEventType.CLIP_GENERATED]: 'Klip Dibuat',
  [ActivityEventType.CLIP_EXPORTED]: 'Klip Diunduh',
  [ActivityEventType.MEMBER_INVITED]: 'Undangan',
  [ActivityEventType.WORKSPACE_DELETED]: 'Workspace Dihapus',
};

// Activity Timeline v2 - type filter chips, generated from
// Object.values(ActivityEventType) so a future 6th event type needs no new
// plumbing here (only a new ACTIVITY_ICONS/TYPE_LABELS entry, which the
// Record<ActivityEventType, ...> shape already forces at compile time).
export function ActivityFilterBar({
  value,
  onChange,
}: {
  value: ActivityEventType | null;
  onChange: (type: ActivityEventType | null) => void;
}) {
  return (
    <div role="group" aria-label="Filter jenis aktivitas" className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant={value === null ? 'default' : 'outline'}
        onClick={() => onChange(null)}
      >
        Semua
      </Button>
      {Object.values(ActivityEventType).map((type) => {
        const Icon = ACTIVITY_ICONS[type];
        return (
          <Button
            key={type}
            size="sm"
            variant={value === type ? 'default' : 'outline'}
            className={cn('gap-1.5')}
            onClick={() => onChange(value === type ? null : type)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {TYPE_LABELS[type]}
          </Button>
        );
      })}
    </div>
  );
}
