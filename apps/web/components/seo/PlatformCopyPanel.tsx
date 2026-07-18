'use client';

import type { SocialPlatform } from '@speedora/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { generatePlatformCopy, listClipPlatformCopies } from '@/lib/api';
import {
  isPlatformCopyInFlight,
  latestPlatformCopy,
  platformCopyStatusBadge,
} from '@/lib/platform-copy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-rose-500/40 text-rose-400',
};

// Publishing Expansion Phase 7B (AI SEO) - one SWR fetch covers ALL
// platforms for the clip (['platform-copy', clipId]); switching the
// `platform` prop just re-derives `latestPlatformCopy()` from the already-
// cached list on every render, rather than triggering a new request - so
// flipping between platforms in the Publish row (Phase 6C) is free and
// never shows stale cross-platform data. `refreshInterval` closes over the
// current `platform` prop so polling starts/stops correctly per platform,
// same self-stopping-poll technique as ExportTypeRow.tsx.
//
// This is the first "regenerate one AI field" UI in this app - append-only
// on the backend (every Generate/Regenerate creates a NEW row, see
// ClipPlatformCopy's schema comment), so "Generate" and "Regenerate" call
// the exact same function. No cancel - this codebase has no job-
// cancellation mechanism anywhere; switching platforms mid-generation
// doesn't stop the in-flight job, switching back just resumes
// showing/polling it via the already-existing row.
export function PlatformCopyPanel({
  clipId,
  platform,
}: {
  clipId: string;
  platform: SocialPlatform;
}) {
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, mutate } = useSWR(
    ['platform-copy', clipId],
    () => listClipPlatformCopies(clipId),
    {
      refreshInterval: (latest) => {
        const current = latest ? latestPlatformCopy(latest.copies, platform) : undefined;
        return current && isPlatformCopyInFlight(current.status) ? 2000 : 0;
      },
    },
  );

  const current = data ? latestPlatformCopy(data.copies, platform) : undefined;
  const badge = current ? platformCopyStatusBadge(current.status) : null;

  async function handleGenerate() {
    setGenerateError(null);
    setGenerating(true);
    setCopied(false);
    try {
      const created = await generatePlatformCopy(clipId, platform);
      await mutate(
        (prev) => (prev ? { copies: [created, ...prev.copies] } : { copies: [created] }),
        { revalidate: false },
      );
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Gagal generate SEO copy');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!current?.caption) return;
    const text = [current.caption, current.hashtags.map((h) => `#${h}`).join(' ')]
      .filter(Boolean)
      .join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-slate-panel/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            SEO Copy
          </span>
          {badge && (
            <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
              {badge.label}
            </Badge>
          )}
        </div>

        {!current || current.status === 'FAILED' ? (
          <Button size="sm" variant="outline" disabled={generating} onClick={handleGenerate}>
            {generating ? 'Membuat...' : current ? 'Retry' : 'Generate SEO Copy'}
          </Button>
        ) : current.status === 'READY' ? (
          <Button size="sm" variant="ghost" disabled={generating} onClick={handleGenerate}>
            {generating ? 'Membuat...' : 'Regenerate'}
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Generating...
          </span>
        )}
      </div>

      {generateError && (
        <p className="mt-1.5 font-body text-xs text-destructive">{generateError}</p>
      )}
      {current?.status === 'FAILED' && current.failReason && (
        <p className="mt-1.5 font-body text-xs text-destructive">{current.failReason}</p>
      )}

      {current?.status === 'READY' && (
        <div className="mt-2 space-y-1.5">
          <p className="font-body text-sm text-foreground">{current.caption}</p>
          {current.hashtags.length > 0 && (
            <p className="font-mono text-xs text-chrome">
              {current.hashtags.map((tag) => `#${tag}`).join(' ')}
            </p>
          )}
          {current.description && (
            <p className="font-body text-xs text-muted-foreground">{current.description}</p>
          )}
          <Button size="sm" variant="outline" onClick={handleCopy}>
            {copied ? 'Tersalin' : 'Copy'}
          </Button>
        </div>
      )}
    </div>
  );
}
