'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { getClipPlatformFit } from '@/lib/api';
import { bestTimeLabel } from '@/lib/platform-fit';
import { platformLabel } from '@/lib/platform-metadata';
import { PlatformFitPanel } from './PlatformFitPanel';

// Publishing Expansion Phase 7A (AI SEO - Platform-Fit Recommendation). The
// compact one-line hint shown inline in DashboardClient's per-clip publish
// row - "Best fit: TikTok · Tue/Thu evenings" with a "Why?" expand
// affordance that reveals the full PlatformFitPanel breakdown. Uses the
// same SWR key (['platform-fit', clipId]) as PlatformFitPanel, so
// expanding never triggers a second network request - SWR dedupes by key.
export function PlatformFitHint({ clipId }: { clipId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useSWR(['platform-fit', clipId], () => getClipPlatformFit(clipId));

  const top = data?.rankings[0];
  if (!top) return null;

  const time = bestTimeLabel(top.platform);

  return (
    <div className="mt-1">
      <p className="font-mono text-xs text-muted-foreground">
        Best fit: <span className="text-primary">{platformLabel(top.platform)}</span>
        {time && ` · ${time}`}{' '}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {expanded ? 'Sembunyikan' : 'Why?'}
        </button>
      </p>
      {expanded && (
        <div className="mt-2 rounded-md border border-border bg-muted/60 p-2">
          <PlatformFitPanel clipId={clipId} />
        </div>
      )}
    </div>
  );
}
