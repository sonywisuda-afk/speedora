'use client';

import { useMemo, useState } from 'react';
import type { TopVideoRow } from '@speedora/shared';
import { sortByNumericField, type SortDirection } from '@/lib/performance';

export interface TopVideosTableProps {
  videos: TopVideoRow[];
}

type SortableKey = 'averageEngagementScore' | 'averageHighlightScore' | 'totalViews';

const SORTABLE_COLUMNS: Array<{ key: SortableKey; label: string }> = [
  { key: 'averageEngagementScore', label: 'Avg Engagement' },
  { key: 'averageHighlightScore', label: 'Avg Highlight Score' },
  { key: 'totalViews', label: 'Total Views' },
];

export function TopVideosTable({ videos }: TopVideosTableProps) {
  const [sortKey, setSortKey] = useState<SortableKey>('averageEngagementScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedVideos = useMemo(
    () => sortByNumericField(videos, sortKey, sortDirection),
    [videos, sortKey, sortDirection],
  );

  function toggleSort(key: SortableKey) {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  }

  if (videos.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum ada video dengan klip yang dipublikasikan pada rentang waktu ini.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Video
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Jumlah Klip
            </th>
            {SORTABLE_COLUMNS.map((column) => (
              <th key={column.key} className="p-2 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-primary"
                >
                  {column.label}
                  {sortKey === column.key ? (sortDirection === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Total Likes
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Total Shares
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedVideos.map((video) => (
            <tr key={video.videoId} className="border-b border-border/50">
              <td className="max-w-[16rem] truncate p-2 text-foreground">{video.videoLabel}</td>
              <td className="p-2 text-right font-mono text-foreground">{video.clipCount}</td>
              <td className="p-2 text-right font-mono text-primary">
                {video.averageEngagementScore !== null
                  ? video.averageEngagementScore.toFixed(2)
                  : '—'}
              </td>
              <td className="p-2 text-right font-mono text-ai">
                {video.averageHighlightScore !== null
                  ? Math.round(video.averageHighlightScore)
                  : '—'}
              </td>
              <td className="p-2 text-right font-mono text-foreground">{video.totalViews}</td>
              <td className="p-2 text-right font-mono text-foreground">{video.totalLikes}</td>
              <td className="p-2 text-right font-mono text-foreground">{video.totalShares}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
