'use client';

import { DAY_LABELS } from '@/lib/timezones';
import { cn } from '@/lib/utils';

export interface DaysOfWeekPickerProps {
  value: number[];
  onChange: (days: number[]) => void;
}

// 7-button toggle group, same active/inactive styling convention as
// DateRangeFilter (analytics) - no Select/multi-toggle UI primitive exists
// in this app, and 7 fixed options doesn't need one.
export function DaysOfWeekPicker({ value, onChange }: DaysOfWeekPickerProps) {
  function toggle(day: number) {
    if (value.includes(day)) {
      onChange(value.filter((d) => d !== day).sort((a, b) => a - b));
    } else {
      onChange([...value, day].sort((a, b) => a - b));
    }
  }

  return (
    <div className="flex gap-1">
      {DAY_LABELS.map((label, day) => {
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            aria-pressed={active}
            className={cn(
              'h-8 w-8 rounded-md font-mono text-xs transition-colors',
              active
                ? 'bg-primary-surface font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {label[0]}
          </button>
        );
      })}
    </div>
  );
}
