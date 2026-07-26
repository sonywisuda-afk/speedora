'use client';

import type { Clip } from '@speedora/shared';
import { clipThumbnailUrl } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  fallbackBadge,
  formatTimestamp,
  sortThumbnailContributions,
} from '@/lib/thumbnail-selection';
import { toPercent } from '@/lib/explainability';
import { cn } from '@/lib/utils';

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-rose-500/40 text-rose-400',
};

// Phase 4 of the thumbnail roadmap (AI Thumbnail Selection) - a read-only
// "why this frame" panel, same shape/precedent as ExplainabilityDetailPanel
// for highlightScore. Deliberately NEVER reads highlightScore/highlightRank
// itself (see @speedora/contracts' thumbnail-selection.ts POLICY comment) -
// this is Level 2 (which frame within this already-chosen clip), a
// completely separate decision from which clip got chosen in the first
// place. No separate API round trip needed - every field here is already
// inline on the Clip object from getVideo(), unlike the detail highlight
// explainability panel's own getClipExplainability() call.
export function ThumbnailSelectionPanel({ clip }: { clip: Clip }) {
  if (clip.thumbnailSelectionTimestamp === null || clip.thumbnailSelectionFallback === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pemilihan Thumbnail</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-body text-sm text-muted-foreground">
            Klip ini belum melalui proses pemilihan thumbnail AI (render ulang untuk
            memperbaruinya).
          </p>
        </CardContent>
      </Card>
    );
  }

  const badge = fallbackBadge(clip.thumbnailSelectionFallback);
  const contributions = sortThumbnailContributions(clip.thumbnailSelectionBreakdown ?? []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Pemilihan Thumbnail</CardTitle>
        <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
          {badge.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          {clip.thumbnailUrl ? (
            <img
              src={clipThumbnailUrl(clip.thumbnailUrl)}
              crossOrigin="use-credentials"
              alt="Frame thumbnail terpilih"
              className="h-20 w-auto rounded-md border border-border object-cover"
              style={{ aspectRatio: '9/16' }}
            />
          ) : null}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Timestamp Terpilih
            </p>
            <p className="font-display text-2xl text-foreground">
              {formatTimestamp(clip.thumbnailSelectionTimestamp)}
            </p>
          </div>
        </div>

        {clip.thumbnailSelectionReason ? (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Kenapa frame ini dipilih
            </p>
            <p className="mt-1 font-body text-sm text-foreground">
              {clip.thumbnailSelectionReason}
            </p>
          </div>
        ) : null}

        {contributions.length > 0 ? (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Kontribusi Sinyal (pada timestamp terpilih)
            </p>
            <div className="mt-2 space-y-2">
              {contributions.map((contribution) => (
                <div key={contribution.signal} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {contribution.signal}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-panel">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        contribution.weight > 0 ? 'bg-signal-cyan' : 'bg-muted-foreground/40',
                      )}
                      style={{ width: `${toPercent(contribution.normalizedValue)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] text-signal-cyan">
                    {toPercent(contribution.normalizedValue)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
