'use client';

import type { ClipPerformancePlatformSeries, SocialPlatform } from '@speedora/shared';
import { getMetricCapability, type MetricKey } from '@speedora/analytics-report';
import { PLATFORM_LABELS } from '@/lib/analytics';
import { formatPublishDate } from '@/lib/performance';
import { PUBLISH_STATUS_LABELS } from '@/lib/scheduling';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UnavailableMetric } from '@/components/analytics/UnavailableMetric';

export interface ClipPerformanceHistoryTableProps {
  performance: ClipPerformancePlatformSeries[];
}

const METRIC_COLUMNS: Array<{ key: MetricKey; label: string; field: string }> = [
  { key: 'views', label: 'Views', field: 'viewCount' },
  { key: 'likes', label: 'Likes', field: 'likeCount' },
  { key: 'comments', label: 'Comments', field: 'commentCount' },
  { key: 'shares', label: 'Shares', field: 'shareCount' },
  { key: 'watchTime', label: 'Watch Time (s)', field: 'watchTimeSeconds' },
];

// Sprint 6C - real per-platform history, oldest-to-newest from the API
// (ready for a future trend chart), reversed here purely for display so the
// most recent snapshot reads first, like a log. Every metric cell checks
// platform-capability.util.ts (Sprint 6A's single source of truth) before
// rendering a number - a platform that doesn't expose a metric shows
// UnavailableMetric with its real reason, never a bare dash that could be
// mistaken for "zero."
export function ClipPerformanceHistoryTable({ performance }: ClipPerformanceHistoryTableProps) {
  if (performance.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Klip ini belum pernah dipublikasikan ke platform manapun.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {performance.map((series) => (
        <Card key={series.publishRecordId}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{PLATFORM_LABELS[series.platform]}</span>
              <span className="font-mono text-xs font-normal normal-case text-muted-foreground">
                {PUBLISH_STATUS_LABELS[series.status]}
                {series.publishedAt ? ` · ${formatPublishDate(series.publishedAt)}` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {series.history.length === 0 ? (
              <p className="font-body text-sm text-muted-foreground">
                Belum ada data statistik untuk publikasi ini.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-body text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Diambil Pada
                      </th>
                      {METRIC_COLUMNS.map((column) => (
                        <th
                          key={column.key}
                          className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                          {column.label}
                        </th>
                      ))}
                      <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Engagement
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...series.history].reverse().map((point) => (
                      <tr key={point.capturedAt} className="border-b border-border/50">
                        <td className="p-2 text-muted-foreground">
                          {formatPublishDate(point.capturedAt)}
                        </td>
                        {METRIC_COLUMNS.map((column) => (
                          <td key={column.key} className="p-2 text-right font-mono text-foreground">
                            <MetricCell
                              platform={series.platform}
                              metric={column.key}
                              value={point[column.field as keyof typeof point] as number | null}
                            />
                          </td>
                        ))}
                        <td className="p-2 text-right font-mono text-signal-cyan">
                          {point.engagementScore !== null ? point.engagementScore.toFixed(2) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MetricCell({
  platform,
  metric,
  value,
}: {
  platform: SocialPlatform;
  metric: MetricKey;
  value: number | null;
}) {
  const capability = getMetricCapability(platform, metric);
  if (capability.availability !== 'available') {
    return (
      <UnavailableMetric
        label={metric}
        reason={capability.reason ?? 'Tidak tersedia di platform ini.'}
        variant="inline"
      />
    );
  }
  return <>{value ?? '—'}</>;
}
