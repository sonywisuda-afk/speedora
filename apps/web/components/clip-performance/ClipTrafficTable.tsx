'use client';

import type { ClipTrafficEntry, TrackedLinkDto } from '@speedora/shared';
import { useState } from 'react';
import { PLATFORM_LABELS } from '@/lib/analytics';
import { formatPublishDate } from '@/lib/performance';
import { PUBLISH_STATUS_LABELS } from '@/lib/scheduling';
import { TrackedLinkCreator } from '@/components/analytics/TrackedLinkCreator';

export interface ClipTrafficTableProps {
  traffic: ClipTrafficEntry[];
  workspaceId: string;
}

// Sprint 6C - Speedora's own distribution metadata, never platform-referrer
// traffic (search/browse/suggested/external), which no connected platform
// exposes without the deferred YouTube Analytics API. campaign and
// recurringSchedule are shown as independent columns, not collapsed into a
// single "source" label, since a PublishRecord can genuinely belong to
// neither, either, or both at once (see PublishRecord's own schema
// comment) - a single enum here would misrepresent that combination.
export function ClipTrafficTable({ traffic, workspaceId }: ClipTrafficTableProps) {
  // Sprint 6K (Conversion) - a just-created link's redirectUrl isn't part
  // of ClipTrafficEntry (that's `traffic`'s own already-fetched shape);
  // keyed by publishRecordId so this survives re-renders without needing
  // the parent to re-fetch just to show what was just created.
  const [justCreated, setJustCreated] = useState<Record<string, TrackedLinkDto>>({});

  if (traffic.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Klip ini belum pernah dipublikasikan ke platform manapun.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Platform
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Status
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Dijadwalkan
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Dipublikasikan
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Campaign
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Recurring Schedule
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Conversion
            </th>
          </tr>
        </thead>
        <tbody>
          {traffic.map((entry) => {
            const created = justCreated[entry.publishRecordId];
            return (
              <tr key={entry.publishRecordId} className="border-b border-border/50">
                <td className="p-2 text-foreground">{PLATFORM_LABELS[entry.platform]}</td>
                <td className="p-2 text-muted-foreground">{PUBLISH_STATUS_LABELS[entry.status]}</td>
                <td className="p-2 text-muted-foreground">
                  {entry.scheduledAt ? formatPublishDate(entry.scheduledAt) : '—'}
                </td>
                <td className="p-2 text-muted-foreground">
                  {entry.publishedAt ? formatPublishDate(entry.publishedAt) : '—'}
                </td>
                <td className="p-2 text-muted-foreground">{entry.campaign?.name ?? '—'}</td>
                <td className="p-2 text-muted-foreground">
                  {entry.recurringSchedule?.name ?? '—'}
                </td>
                <td className="p-2 text-muted-foreground">
                  {entry.conversionCount !== null ? (
                    <span className="font-mono text-foreground">
                      {entry.conversionCount.toLocaleString()} klik
                    </span>
                  ) : created ? (
                    <span className="font-mono text-xs text-signal-cyan">{created.redirectUrl}</span>
                  ) : (
                    <TrackedLinkCreator
                      workspaceId={workspaceId}
                      target={{ publishRecordId: entry.publishRecordId }}
                      onCreated={(link) =>
                        setJustCreated((prev) => ({ ...prev, [entry.publishRecordId]: link }))
                      }
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
