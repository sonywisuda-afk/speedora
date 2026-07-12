'use client';

import { useMemo, useState } from 'react';
import type { TopClipRow } from '@speedora/shared';
import { clipThumbnailUrl } from '@/lib/api';
import { PLATFORM_LABELS } from '@/lib/analytics';
import { formatPublishDate, sortByNumericField, type SortDirection } from '@/lib/performance';
import { ClipThumbnail } from './ClipThumbnail';

export interface TopClipsTableProps {
  clips: TopClipRow[];
}

type SortableKey = 'engagementScore' | 'viewCount' | 'highlightScore';

const SORTABLE_COLUMNS: Array<{ key: SortableKey; label: string }> = [
  { key: 'engagementScore', label: 'Engagement' },
  { key: 'viewCount', label: 'Views' },
  { key: 'highlightScore', label: 'Highlight Score' },
];

// Client-side re-sort on column click (design decision #2) - the API
// already returns rows sorted by engagementScore descending by default.
export function TopClipsTable({ clips }: TopClipsTableProps) {
  const [sortKey, setSortKey] = useState<SortableKey>('engagementScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedClips = useMemo(
    () => sortByNumericField(clips, sortKey, sortDirection),
    [clips, sortKey, sortDirection],
  );

  function toggleSort(key: SortableKey) {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  }

  if (clips.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum ada klip yang dipublikasikan pada rentang waktu ini.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Thumbnail
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Video
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Platform
            </th>
            {SORTABLE_COLUMNS.map((column) => (
              <th key={column.key} className="p-2 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-signal-cyan"
                >
                  {column.label}
                  {sortKey === column.key ? (sortDirection === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Likes
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Comments
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Shares
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Publish Date
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedClips.map((clip) => (
            <tr key={clip.publishRecordId} className="border-b border-border/50">
              <td className="p-2">
                <ClipThumbnail
                  thumbnailUrl={clip.thumbnailUrl ? clipThumbnailUrl(clip.thumbnailUrl) : null}
                />
              </td>
              <td className="max-w-[12rem] truncate p-2 text-foreground">{clip.videoLabel}</td>
              <td className="p-2 text-muted-foreground">{PLATFORM_LABELS[clip.platform]}</td>
              <td className="p-2 text-right font-mono text-signal-cyan">
                {clip.highlightScore !== null ? Math.round(clip.highlightScore) : '—'}
              </td>
              <td className="p-2 text-right font-mono text-signal-cyan">
                {clip.engagementScore !== null ? clip.engagementScore.toFixed(2) : '—'}
              </td>
              <td className="p-2 text-right font-mono text-foreground">{clip.viewCount ?? '—'}</td>
              <td className="p-2 text-right font-mono text-foreground">{clip.likeCount ?? '—'}</td>
              <td className="p-2 text-right font-mono text-foreground">{clip.commentCount ?? '—'}</td>
              <td className="p-2 text-right font-mono text-foreground">{clip.shareCount ?? '—'}</td>
              <td className="p-2 text-right font-mono text-muted-foreground">
                {formatPublishDate(clip.publishedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
