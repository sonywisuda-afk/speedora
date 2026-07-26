'use client';

import type { ClipVersionDto } from '@speedora/shared';
import { useState } from 'react';
import useSWR from 'swr';
import {
  clipVersionDownloadUrl,
  clipVersionThumbnailUrl,
  listClipVersions,
  restoreClipVersion,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/dashboard';
import { formatTimestamp } from '@/lib/thumbnail-selection';
import { useTimelineStore } from '@/lib/timelineStore';

// Sprint 5E (Version Compare & History). Operates on whichever clip is
// currently selected in the Timeline Editor (useTimelineStore) - a version
// list/compare view scoped to "the video as a whole" wouldn't map cleanly
// onto ClipVersion's per-clip snapshots. Compare is against the LIVE clip
// state already held in the timeline store (no extra fetch needed) rather
// than between two past versions - the common real question is "did my
// last re-render actually change anything," not an arbitrary N-vs-M diff.
export function VersionHistoryPanel() {
  const selectedClipId = useTimelineStore((s) => s.selectedClipId);
  const clips = useTimelineStore((s) => s.clips);
  const setClipRange = useTimelineStore((s) => s.setClipRange);
  const setCaptionStyle = useTimelineStore((s) => s.setCaptionStyle);
  const setHookText = useTimelineStore((s) => s.setHookText);
  const setHashtags = useTimelineStore((s) => s.setHashtags);
  const saveClip = useTimelineStore((s) => s.saveClip);

  const currentClip = clips.find((c) => c.id === selectedClipId) ?? null;

  const { data, mutate } = useSWR(selectedClipId ? ['clip-versions', selectedClipId] : null, () =>
    listClipVersions(selectedClipId as string),
  );

  const [compareId, setCompareId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!selectedClipId || !currentClip) return null;

  const versions = data?.versions ?? [];
  const compareVersion = versions.find((v) => v.id === compareId) ?? null;

  async function handleRestore(version: ClipVersionDto) {
    if (!selectedClipId) return;
    setError(null);
    setRestoringId(version.id);
    try {
      await restoreClipVersion(selectedClipId, version.id);
      setClipRange(selectedClipId, version.startTime, version.endTime);
      setCaptionStyle(selectedClipId, version.captionStyle);
      setHookText(selectedClipId, version.hookText ?? '');
      setHashtags(selectedClipId, version.hashtags);
      await saveClip(selectedClipId);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal restore versi');
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">
        Version History
      </h2>

      {error && <p className="mt-1 font-body text-xs text-destructive">{error}</p>}

      {versions.length === 0 ? (
        <p className="mt-2 font-body text-sm text-muted-foreground">
          Belum ada versi sebelumnya - render ulang klip ini untuk mulai membuat riwayat.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-slate-panel p-2 font-body text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">v{version.versionNumber}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTimestamp(version.startTime)}–{formatTimestamp(version.endTime)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(version.createdAt)} oleh {version.createdByEmail}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {version.downloadUrl && (
                  <a
                    href={clipVersionDownloadUrl(version.downloadUrl)}
                    className="text-xs text-signal-cyan underline"
                  >
                    Unduh
                  </a>
                )}
                <button
                  onClick={() => setCompareId(compareId === version.id ? null : version.id)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  {compareId === version.id ? 'Tutup Compare' : 'Compare'}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restoringId === version.id}
                  onClick={() => handleRestore(version)}
                >
                  {restoringId === version.id ? 'Restoring...' : 'Restore'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {compareVersion && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-slate-panel p-3 sm:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              v{compareVersion.versionNumber} (lama)
            </p>
            {compareVersion.thumbnailUrl && (
              <img
                src={clipVersionThumbnailUrl(compareVersion.thumbnailUrl)}
                alt={`Thumbnail v${compareVersion.versionNumber}`}
                className="mt-1 aspect-[9/16] w-full rounded object-cover"
              />
            )}
            <dl className="mt-2 space-y-1 font-body text-xs text-muted-foreground">
              <div>
                Trim: {formatTimestamp(compareVersion.startTime)}–
                {formatTimestamp(compareVersion.endTime)}
              </div>
              <div>Caption: {compareVersion.captionStyle}</div>
              <div>Hook: {compareVersion.hookText ?? '—'}</div>
              <div>Hashtags: {compareVersion.hashtags.map((t) => `#${t}`).join(' ') || '—'}</div>
            </dl>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-signal-cyan">Saat Ini</p>
            <dl className="mt-2 space-y-1 font-body text-xs text-muted-foreground">
              <div>
                Trim: {formatTimestamp(currentClip.startTime)}–
                {formatTimestamp(currentClip.endTime)}
              </div>
              <div>Caption: {currentClip.captionStyle}</div>
              <div>Hook: {currentClip.hookText ?? '—'}</div>
              <div>Hashtags: {currentClip.hashtags.map((t) => `#${t}`).join(' ') || '—'}</div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
