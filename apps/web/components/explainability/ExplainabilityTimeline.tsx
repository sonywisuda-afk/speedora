'use client';

import { cn } from '@/lib/utils';

export interface TimelineClipSummary {
  id: string;
  startTime: number;
  endTime: number;
  highlightScore: number | null;
  hookText: string | null;
}

export interface ExplainabilityTimelineProps {
  clips: TimelineClipSummary[];
  duration: number | null;
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
}

// Same percentage-positioned-button heatmap technique as
// VideoAnalysisDashboard.tsx's existing virality heatmap, but keyed on
// highlightScore and colored Signal Cyan instead of Signal Pink -
// deliberately a different hue so this never reads as "the same score" as
// the existing virality heatmap elsewhere in the app (see docs/ai/scoring.md
// on why these must stay visually distinct). A clip with no highlightScore
// yet renders as a muted gray segment, not a hidden/zero-width one - "a
// clip exists here, not yet scored" is itself information worth keeping
// visible, same reasoning the virality heatmap already uses for low scores.
export function ExplainabilityTimeline({
  clips,
  duration,
  selectedClipId,
  onSelectClip,
}: ExplainabilityTimelineProps) {
  if (!duration || duration <= 0 || clips.length === 0) return null;

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Highlight Score di Sepanjang Video
      </p>
      <div className="relative mt-2 h-8 w-full overflow-hidden rounded-sm bg-muted">
        {clips.map((clip) => {
          const left = (clip.startTime / duration) * 100;
          const width = ((clip.endTime - clip.startTime) / duration) * 100;
          const hasScore = clip.highlightScore !== null;
          const intensity = hasScore ? 0.25 + (clip.highlightScore! / 100) * 0.65 : 0.18;
          const isSelected = clip.id === selectedClipId;

          return (
            <button
              key={clip.id}
              type="button"
              onClick={() => onSelectClip(clip.id)}
              className={cn(
                'absolute inset-y-0 transition-opacity hover:opacity-80',
                isSelected && 'ring-2 ring-inset ring-ai',
              )}
              style={{
                left: `${left}%`,
                width: `${Math.max(width, 0.5)}%`,
                backgroundColor: hasScore
                  ? `rgba(34, 230, 214, ${intensity})`
                  : 'rgba(148, 163, 184, 0.25)',
              }}
              title={
                hasScore
                  ? `Highlight score ${Math.round(clip.highlightScore!)}${clip.hookText ? ` — ${clip.hookText}` : ''}`
                  : `Belum dihitung${clip.hookText ? ` — ${clip.hookText}` : ''}`
              }
              aria-label={
                hasScore
                  ? `Pilih klip dengan highlight score ${Math.round(clip.highlightScore!)}`
                  : 'Pilih klip yang belum dihitung highlight score-nya'
              }
            />
          );
        })}
      </div>
    </div>
  );
}
