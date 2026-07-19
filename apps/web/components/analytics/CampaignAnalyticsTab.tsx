'use client';

import type { TrackedLinkDto, TrendGranularity } from '@speedora/shared';
import { useState } from 'react';
import useSWR from 'swr';
import { getCampaignAnalytics } from '@/lib/api';
import { formatEngagementScore, PLATFORM_LABELS } from '@/lib/analytics';
import { AnalyticsCard } from './AnalyticsCard';
import { AnalyticsLoadingState } from './AnalyticsLoadingState';
import { StatTile } from './StatTile';
import { TrackedLinkCreator } from './TrackedLinkCreator';
import { TrendChart } from './TrendChart';

export interface CampaignAnalyticsTabProps {
  campaignId: string;
  workspaceId: string;
}

// Sprint 6E (Campaign-level analytics rollup) - the "Analytics" tab on the
// campaign detail page. Reuses TrendChart (Sprint 6C.5's Analytics UI
// Foundation) for the trend, not a new one-off chart - the granularity
// toggle re-fetches from GET /campaigns/:id/analytics the same way
// /analytics's own Trend panel does. Every number here is real (see the
// backend's own comment: CampaignStatus never gates this data), so an
// empty campaign or one with no PUBLISHED jobs yet just shows honest
// zeros/empty states, not an error.
export function CampaignAnalyticsTab({ campaignId, workspaceId }: CampaignAnalyticsTabProps) {
  const [granularity, setGranularity] = useState<TrendGranularity>('daily');
  // Sprint 6K (Conversion) - see ClipTrafficTable's identical comment: not
  // part of CampaignAnalyticsDto itself, just shown immediately after
  // creation without forcing a re-fetch.
  const [justCreated, setJustCreated] = useState<TrackedLinkDto | null>(null);

  const { data, error } = useSWR(['campaign-analytics', campaignId, granularity], () =>
    getCampaignAnalytics(campaignId, { granularity }),
  );

  if (error) {
    return (
      <p className="font-body text-sm text-destructive">
        {error instanceof Error ? error.message : 'Gagal memuat analytics campaign'}
      </p>
    );
  }
  if (!data) {
    return <AnalyticsLoadingState />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Publikasi" value={String(data.totals.publishCount)} />
        <StatTile label="Views" value={data.totals.totalViews.toLocaleString()} />
        <StatTile label="Likes" value={data.totals.totalLikes.toLocaleString()} />
        <StatTile
          label="Rata-rata Engagement"
          value={formatEngagementScore(data.totals.averageEngagementScore)}
        />
      </div>

      <AnalyticsCard title="Conversion">
        {data.conversionCount !== null ? (
          <p className="font-mono text-2xl text-foreground">
            {data.conversionCount.toLocaleString()} <span className="text-sm text-muted-foreground">klik</span>
          </p>
        ) : justCreated ? (
          <p className="font-body text-sm text-muted-foreground">
            Tracking link dibuat:{' '}
            <span className="font-mono text-xs text-signal-cyan">{justCreated.redirectUrl}</span>
          </p>
        ) : (
          <TrackedLinkCreator
            workspaceId={workspaceId}
            target={{ campaignId }}
            onCreated={setJustCreated}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard title="Tren Views">
        <TrendChart data={data.engagementTrend} granularity={granularity} onGranularityChange={setGranularity} />
      </AnalyticsCard>

      <AnalyticsCard title="Perbandingan Platform">
        {data.platformBreakdown.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">
            Belum ada publikasi pada campaign ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-body text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Platform
                  </th>
                  <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Publikasi
                  </th>
                  <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Views
                  </th>
                  <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Likes
                  </th>
                  <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Engagement
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.platformBreakdown.map((row) => (
                  <tr key={row.platform} className="border-b border-border/50">
                    <td className="p-2 text-foreground">{PLATFORM_LABELS[row.platform]}</td>
                    <td className="p-2 text-right font-mono text-foreground">{row.publishCount}</td>
                    <td className="p-2 text-right font-mono text-foreground">{row.totalViews}</td>
                    <td className="p-2 text-right font-mono text-foreground">{row.totalLikes}</td>
                    <td className="p-2 text-right font-mono text-signal-cyan">
                      {formatEngagementScore(row.averageEngagementScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AnalyticsCard>
    </div>
  );
}
