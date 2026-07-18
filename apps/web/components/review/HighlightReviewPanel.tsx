'use client';

import type { Clip } from '@speedora/shared';
import Link from 'next/link';
import { ScoreGauge } from '@/components/ScoreGauge';
import { useTimelineStore } from '@/lib/timelineStore';

// Sprint 5G (Review Mode) - clips ranked by the Fusion Engine's own
// highlightRank (falling back to highlightScore desc for clips predating
// ranking), so a reviewer works through the strongest candidates first.
// Deliberately NOT a rebuild of the existing Milestone 4 AI Explainability
// page (/videos/[id]/explainability) - that page's SignalBreakdownChart/
// ExplainabilityDetailPanel already do the deep per-signal breakdown well;
// this panel is a compact triage list that links out to it per clip.
export function HighlightReviewPanel({
  videoId,
  clips,
}: {
  videoId: string;
  clips: Clip[];
}) {
  const setPlayhead = useTimelineStore((s) => s.setPlayhead);

  const ranked = [...clips].sort((a, b) => {
    if (a.highlightRank !== null && b.highlightRank !== null) {
      return a.highlightRank - b.highlightRank;
    }
    return (b.highlightScore ?? 0) - (a.highlightScore ?? 0);
  });

  if (ranked.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Belum ada klip.</p>;
  }

  return (
    <div className="space-y-2">
      {ranked.map((clip) => (
        <div
          key={clip.id}
          className="flex items-center gap-3 rounded-md border border-border bg-slate-panel p-3"
        >
          <button onClick={() => setPlayhead(clip.startTime)} className="shrink-0">
            <ScoreGauge score={clip.highlightScore ?? clip.viralityScore} size={32} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-body text-sm text-foreground">
              {clip.hookText ?? `Klip ${clip.startTime.toFixed(1)}s`}
            </p>
            {clip.highlightReason && (
              <p className="truncate font-body text-xs text-muted-foreground">
                {clip.highlightReason}
              </p>
            )}
          </div>
          <Link
            href={`/videos/${videoId}/explainability?clip=${clip.id}`}
            className="shrink-0 font-body text-xs text-signal-cyan underline"
          >
            Detail
          </Link>
        </div>
      ))}
    </div>
  );
}
