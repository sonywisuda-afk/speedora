'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

export interface ScoreGaugeProps {
  /** Virality score, 0-100. */
  score: number;
  size?: number;
  className?: string;
}

/**
 * Arc gauge for a clip's virality score — Signal Pink to Signal Cyan duotone
 * stroke standing in for a bare number, since a raw digit doesn't read as a
 * meter at a glance.
 */
export function ScoreGauge({ score, size = 64, className }: ScoreGaugeProps) {
  const gradientId = useId();
  const clamped = Math.min(100, Math.max(0, score));
  const strokeWidth = Math.max(3, size * 0.07);
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Virality score ${Math.round(clamped)} out of 100`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF3B7F" />
            <stop offset="100%" stopColor="#22E6D6" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-slate-panel"
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
