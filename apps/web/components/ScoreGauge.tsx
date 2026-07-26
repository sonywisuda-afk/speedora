'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

export interface ScoreGaugeProps {
  /** The score this gauge represents, 0-100 - virality score by default, but
   * see `label` below for reusing this gauge with a different 0-100 metric
   * (e.g. Milestone 4's highlightScore). */
  score: number;
  size?: number;
  className?: string;
  /** What this score is, for the aria-label - defaults to "Virality score"
   * so every existing caller's accessible name stays byte-for-byte
   * identical. Speedora has multiple distinct 0-100 scoring systems (see
   * docs/ai/scoring.md) that must never be presented as interchangeable -
   * pass this whenever reusing the gauge for a score that isn't virality. */
  label?: string;
}

/**
 * Arc gauge for a 0-100 score — a primary-to-ai-accent duotone stroke
 * standing in for a bare number, since a raw digit doesn't read as a meter
 * at a glance. The ai-accent pole signals this is an AI-computed score, not
 * a raw fact. Originally built for virality score; reusable for any other
 * 0-100 metric via `label`.
 */
export function ScoreGauge({
  score,
  size = 64,
  className,
  label = 'Virality score',
}: ScoreGaugeProps) {
  const gradientId = useId();
  const clamped = Math.min(100, Math.max(0, score));
  const strokeWidth = Math.max(3, size * 0.07);
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label={`${label} ${Math.round(clamped)} out of 100`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--ai-accent))" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="fill-none transition-[stroke-dashoffset] duration-700 ease-out"
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span
        className="absolute font-mono font-medium text-foreground"
        style={{ fontSize: size * 0.28 }}
        aria-hidden="true"
      >
        {Math.round(clamped)}
      </span>
    </div>
  );
}
