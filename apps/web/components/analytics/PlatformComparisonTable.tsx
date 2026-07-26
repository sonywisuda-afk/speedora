import type { PlatformComparisonRow } from '@speedora/shared';
import { formatEngagementScore, PLATFORM_LABELS } from '@/lib/analytics';
import { formatGrowthPct } from '@/lib/performance';
import { cn } from '@/lib/utils';

export interface PlatformComparisonTableProps {
  platformComparison: PlatformComparisonRow[];
}

// Always renders all 3 platforms (YouTube/TikTok/Instagram), even with 0
// data for one - a comparison table with a row missing isn't a comparison.
export function PlatformComparisonTable({ platformComparison }: PlatformComparisonTableProps) {
  return (
    <table className="w-full border-collapse font-body text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Platform
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Avg Engagement
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Avg Highlight Score
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Publish Count
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Growth
          </th>
        </tr>
      </thead>
      <tbody>
        {platformComparison.map((row) => (
          <tr key={row.platform} className="border-b border-border/50">
            <td className="p-2 text-foreground">{PLATFORM_LABELS[row.platform]}</td>
            <td className="p-2 text-right font-mono text-primary">
              {formatEngagementScore(row.averageEngagementScore)}
            </td>
            <td className="p-2 text-right font-mono text-ai">
              {row.averageHighlightScore !== null ? Math.round(row.averageHighlightScore) : '—'}
            </td>
            <td className="p-2 text-right font-mono text-foreground">{row.publishCount}</td>
            <td
              className={cn(
                'p-2 text-right font-mono',
                row.growthPct !== null && row.growthPct > 0 && 'text-success',
                row.growthPct !== null && row.growthPct < 0 && 'text-destructive',
                (row.growthPct === null || row.growthPct === 0) && 'text-muted-foreground',
              )}
            >
              {formatGrowthPct(row.growthPct)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
