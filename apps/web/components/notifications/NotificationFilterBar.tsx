'use client';

import { NotificationCategoryV2, NotificationPriorityV2 } from '@speedora/shared';
import { cn } from '@/lib/utils';
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  PRIORITY_DEFINITIONS,
} from '@/lib/notification-definitions-v2';
import type { NotificationCenterFilters } from '@/lib/useNotificationCenter';

const STATE_OPTIONS: { value: NotificationCenterFilters['state']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'archived', label: 'Archived' },
];

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

// A real toggle button (aria-pressed, not just a styled <div>) - keyboard
// and screen-reader accessible by construction, not an afterthought. Active
// state is conveyed by BOTH the filled background AND aria-pressed, never
// color alone.
function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary-surface text-primary'
          : 'border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function NotificationFilterBar({
  filters,
  onChange,
}: {
  filters: NotificationCenterFilters;
  onChange: (patch: Partial<NotificationCenterFilters>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Filter status notifikasi" className="flex flex-wrap gap-2">
        {STATE_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            active={filters.state === option.value}
            onClick={() => onChange({ state: option.value })}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div
        role="group"
        aria-label="Filter kategori notifikasi"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {Object.values(NotificationCategoryV2).map((category) => {
          const Icon = CATEGORY_ICONS[category];
          const active = filters.category === category;
          return (
            <Chip
              key={category}
              active={active}
              onClick={() => onChange({ category: active ? null : category })}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {CATEGORY_LABELS[category]}
            </Chip>
          );
        })}
      </div>

      <div
        role="group"
        aria-label="Filter prioritas notifikasi"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {Object.values(NotificationPriorityV2).map((priority) => {
          const definition = PRIORITY_DEFINITIONS[priority];
          const Icon = definition.icon;
          const active = filters.priority === priority;
          return (
            <Chip
              key={priority}
              active={active}
              onClick={() => onChange({ priority: active ? null : priority })}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {definition.label}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}
