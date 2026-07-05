import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type StageState = 'pending' | 'active' | 'complete' | 'failed';

export function StagePanel({ label, state }: { label: string; state: StageState }) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 text-center transition-colors duration-500',
        state === 'complete' && 'border-signal-cyan/40 bg-signal-cyan/5',
        state === 'active' && 'border-signal-pink bg-signal-pink/5',
        state === 'failed' && 'border-destructive bg-destructive/10',
        state === 'pending' && 'border-border',
      )}
    >
      <div className="flex items-center justify-center gap-2">
        {state === 'complete' ? (
          <Check className="h-4 w-4 shrink-0 text-signal-cyan" aria-hidden="true" />
        ) : state === 'active' ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-signal-pink motion-safe:animate-pulse-slow"
            aria-hidden="true"
          />
        ) : state === 'failed' ? (
          <X className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-chrome/30" aria-hidden="true" />
        )}
        <span
          className={cn(
            'font-display text-sm uppercase tracking-wide',
            state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
