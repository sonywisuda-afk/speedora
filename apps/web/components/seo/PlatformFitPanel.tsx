'use client';

import useSWR from 'swr';
import type { ClipScoreDimension } from '@speedora/shared';
import { getClipPlatformFit } from '@/lib/api';
import { platformIcon, platformLabel } from '@/lib/platform-metadata';
import { bestTimeLabel } from '@/lib/platform-fit';

// Record<ClipScoreDimension, string> instead of Record<string, string> so
// the compiler rejects a build that adds a new ClipScores key without a
// matching label here (same dimensions as TimelineEditor.tsx/
// VideoAnalysisDashboard.tsx's own SCORE_LABELS, kept as a separate copy -
// same "not the 3rd duplication this project extracts at" convention).
const DIMENSION_LABELS: Record<ClipScoreDimension, string> = {
  hookStrength: 'Hook',
  educationalValue: 'Educational',
  practicalValue: 'Practical',
  curiosity: 'Curiosity',
  emotion: 'Emotion',
  storytelling: 'Storytelling',
  novelty: 'Novelty',
  trustAuthority: 'Authority',
  ctaStrength: 'CTA',
};

// Publishing Expansion Phase 7A (AI SEO - Platform-Fit Recommendation). Full
// per-clip breakdown of GET /clips/:id/platform-fit - all 8 platforms
// ranked, each with a score bar (same technique as ops-ai/HistogramBars.tsx)
// and its topDimensions for explainability, plus a static best-time hint
// (BEST_TIME_HEURISTICS, not personalized). Read-only, same spirit as the
// Explainability page but scoped inline rather than a separate route - this
// is a much smaller payload.
export function PlatformFitPanel({ clipId }: { clipId: string }) {
  const { data, error, isLoading } = useSWR(['platform-fit', clipId], () =>
    getClipPlatformFit(clipId),
  );

  if (isLoading) {
    return <p className="font-body text-xs text-muted-foreground">Menghitung...</p>;
  }
  if (error) {
    return (
      <p className="font-body text-xs text-destructive">
        {error instanceof Error ? error.message : 'Gagal memuat platform fit'}
      </p>
    );
  }
  if (!data || data.rankings.length === 0) {
    return (
      <p className="font-body text-xs text-muted-foreground">Belum ada skor AI untuk klip ini.</p>
    );
  }

  const max = Math.max(...data.rankings.map((r) => r.score), 1);

  return (
    <div className="space-y-2">
      {data.rankings.map((entry) => {
        const Icon = platformIcon(entry.platform);
        const time = bestTimeLabel(entry.platform);
        return (
          <div key={entry.platform} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="w-20 shrink-0 font-body text-xs text-foreground">
                {platformLabel(entry.platform)}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, (entry.score / max) * 100))}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-[10px] text-primary">
                {Math.round(entry.score)}
              </span>
            </div>
            <p className="pl-6 font-mono text-[10px] text-muted-foreground">
              {entry.topDimensions.map((d) => DIMENSION_LABELS[d]).join(', ')}
              {time && ` · best: ${time}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
