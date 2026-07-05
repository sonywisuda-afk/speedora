'use client';

import { useMemo, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface LiveReelThumbnail {
  id: string;
  src: string;
  alt?: string;
}

interface LiveReelBaseProps {
  className?: string;
}

interface IdleProps extends LiveReelBaseProps {
  variant: 'idle';
}

interface ProgressProps extends LiveReelBaseProps {
  variant: 'progress';
  /** 0-100. Driven by real job progress (WebSocket/SSE) — never a fake loop. */
  progress: number;
  label?: string;
}

interface ThumbnailStripProps extends LiveReelBaseProps {
  variant: 'thumbnail-strip';
  thumbnails: LiveReelThumbnail[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

interface RulerProps extends LiveReelBaseProps {
  variant: 'ruler';
  durationSeconds: number;
  currentTime?: number;
  onSeek?: (seconds: number) => void;
  /**
   * Absolutely-positioned overlay (e.g. clip-candidate rectangles with trim
   * handles) layered above the tick marks - the ruler stays the single
   * source of truth for seek/playhead, callers just draw on top of it.
   */
  children?: ReactNode;
}

export type LiveReelProps = IdleProps | ProgressProps | ThumbnailStripProps | RulerProps;

/** Deterministic per-index height so server and client render the same bars (no Math.random). */
function waveformHeight(index: number, count: number) {
  const wave = Math.sin(index * 0.7) * 0.5 + Math.cos(index * 0.31) * 0.3;
  return 28 + Math.abs(wave) * 72 * (0.6 + ((index % count) / count) * 0.4);
}

function SprocketRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 px-1', className)} aria-hidden="true">
      {Array.from({ length: 24 }).map((_, i) => (
        <span key={i} className="h-2 w-2 shrink-0 rounded-[1px] bg-chrome/20" />
      ))}
    </div>
  );
}

function IdleReel({ className }: { className?: string }) {
  const bars = useMemo(() => Array.from({ length: 64 }, (_, i) => waveformHeight(i, 64)), []);
  return (
    <div className={cn('relative overflow-hidden', className)} aria-hidden="true">
      <SprocketRow />
      <div className="my-2 flex h-24 items-end gap-1 motion-safe:animate-live-reel-drift">
        {[...bars, ...bars].map((h, i) => (
          <span
            key={i}
            className="w-1.5 shrink-0 rounded-t-sm bg-gradient-to-t from-signal-pink/40 to-signal-cyan/40"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <SprocketRow />
    </div>
  );
}

function ProgressReel({ progress, label, className }: Omit<ProgressProps, 'variant'>) {
  const clamped = Math.min(100, Math.max(0, progress));
  const bars = useMemo(() => Array.from({ length: 40 }, (_, i) => waveformHeight(i, 40)), []);
  return (
    <div
      className={cn('w-full', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progres pemrosesan'}
    >
      <div className="flex h-16 items-end gap-1">
        {bars.map((h, i) => {
          const filled = (i / bars.length) * 100 < clamped;
          return (
            <span
              key={i}
              className={cn(
                'w-1.5 shrink-0 rounded-t-sm transition-colors duration-300',
                filled ? 'bg-signal-pink' : 'bg-slate-panel',
              )}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between font-mono text-xs text-muted-foreground">
        <span>{label ?? 'Memproses'}</span>
        <span className="text-signal-cyan">{Math.round(clamped)}%</span>
      </div>
    </div>
  );
}

function ThumbnailStripReel({
  thumbnails,
  selectedId,
  onSelect,
  className,
}: Omit<ThumbnailStripProps, 'variant'>) {
  const frameClassName = (thumb: LiveReelThumbnail) =>
    cn(
      'relative aspect-[9/16] w-24 shrink-0 overflow-hidden bg-slate-panel bg-cover bg-center transition-shadow',
      selectedId === thumb.id && 'ring-2 ring-inset ring-signal-pink',
    );
  const frameStyle = (thumb: LiveReelThumbnail) => ({ backgroundImage: `url("${thumb.src}")` });

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <div className="inline-flex items-stretch gap-px bg-border p-px">
        {thumbnails.map((thumb) =>
          // Only render as <button> when there's a real onSelect to fire - a
          // clickable-looking control with no handler is worse than a plain
          // <div>, and callers that just want the filmstrip as a preview
          // (e.g. nested inside a card that's itself a link) would
          // otherwise get invalid nested interactive elements.
          onSelect ? (
            <button
              key={thumb.id}
              type="button"
              onClick={() => onSelect(thumb.id)}
              aria-pressed={selectedId === thumb.id}
              aria-label={thumb.alt ?? 'Clip thumbnail'}
              className={frameClassName(thumb)}
              style={frameStyle(thumb)}
            />
          ) : (
            <div
              key={thumb.id}
              aria-label={thumb.alt ?? 'Clip thumbnail'}
              className={frameClassName(thumb)}
              style={frameStyle(thumb)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function RulerReel({
  durationSeconds,
  currentTime = 0,
  onSeek,
  className,
  children,
}: Omit<RulerProps, 'variant'>) {
  const majorStepSeconds = durationSeconds > 120 ? 30 : durationSeconds > 30 ? 10 : 5;
  const majorTicks = Math.max(1, Math.floor(durationSeconds / majorStepSeconds));
  const playheadPct = durationSeconds > 0 ? Math.min(100, (currentTime / durationSeconds) * 100) : 0;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * durationSeconds);
  }

  return (
    <div
      className={cn('relative h-10 w-full cursor-pointer select-none bg-slate-panel', className)}
      onClick={handleClick}
      role="slider"
      aria-label="Timeline ruler"
      aria-valuemin={0}
      aria-valuemax={durationSeconds}
      aria-valuenow={currentTime}
    >
      <div className="flex h-full items-end">
        {Array.from({ length: majorTicks + 1 }).map((_, i) => {
          const seconds = i * majorStepSeconds;
          const minutes = Math.floor(seconds / 60);
          const secs = seconds % 60;
          return (
            <div
              key={i}
              className="relative h-full flex-1 border-l border-chrome/20 pl-1"
              aria-hidden="true"
            >
              <span className="font-mono text-[10px] text-chrome">
                {minutes}:{secs.toString().padStart(2, '0')}
              </span>
            </div>
          );
        })}
      </div>
      {children}
      <div
        className="pointer-events-none absolute top-0 h-full w-px bg-signal-pink"
        style={{ left: `${playheadPct}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * The Live Reel — shared filmstrip/waveform motif (sprocket ticks + audio
 * waveform silhouette), re-rendered per screen with a different function:
 * idle texture, real processing progress, gallery thumbnail strip, or
 * timeline ruler. One component, four data-driven render modes — not four
 * copies of the same decoration.
 */
export function LiveReel(props: LiveReelProps) {
  switch (props.variant) {
    case 'idle':
      return <IdleReel className={props.className} />;
    case 'progress':
      return <ProgressReel progress={props.progress} label={props.label} className={props.className} />;
    case 'thumbnail-strip':
      return (
        <ThumbnailStripReel
          thumbnails={props.thumbnails}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          className={props.className}
        />
      );
    case 'ruler':
      return (
        <RulerReel
          durationSeconds={props.durationSeconds}
          currentTime={props.currentTime}
          onSeek={props.onSeek}
          className={props.className}
        >
          {props.children}
        </RulerReel>
      );
  }
}
