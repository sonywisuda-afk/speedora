import { cn } from '@/lib/utils';

export interface LetterboxBandProps {
  /** `accent` lifts the line to Signal Pink for a hero/high-emphasis boundary. */
  tone?: 'default' | 'accent';
  className?: string;
}

/**
 * Hairline section boundary — echoes a film aspect-ratio letterbox bar.
 * Place one above and/or below a section; reserved for major section breaks
 * (hero, marketing section transitions), not decoration to sprinkle everywhere.
 */
export function LetterboxBand({ tone = 'default', className }: LetterboxBandProps) {
  return (
    <div
      role="presentation"
      className={cn('h-px w-full', tone === 'accent' ? 'bg-signal-pink' : 'bg-border', className)}
    />
  );
}
