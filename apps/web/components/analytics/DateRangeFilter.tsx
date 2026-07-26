'use client';

import { DAY_RANGE_OPTIONS } from '@/lib/performance';
import { cn } from '@/lib/utils';

export interface DateRangeFilterProps {
  value: 7 | 30 | 90;
  onChange: (days: 7 | 30 | 90) => void;
}

// Small button-group, active state styled like Nav.tsx's active link - no
// Select UI primitive exists in this app (components/ui/), and a 3-option
// toggle doesn't need one.
export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex gap-1">
      {DAY_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-current={value === option.value ? 'true' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 font-mono text-xs transition-colors',
            value === option.value
              ? 'bg-primary-surface font-medium text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
