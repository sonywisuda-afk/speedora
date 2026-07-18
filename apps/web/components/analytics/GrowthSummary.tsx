import type { GrowthSummary as GrowthSummaryDto, GrowthMetric } from '@speedora/shared';
import { Card, CardContent } from '@/components/ui/card';
import { formatGrowthPct } from '@/lib/performance';
import { cn } from '@/lib/utils';

export interface GrowthSummaryProps {
  growthSummary: GrowthSummaryDto;
}

function formatMetricValue(value: number | null): string {
  return value === null ? '—' : value % 1 === 0 ? String(value) : value.toFixed(2);
}

function growthTone(growthPct: number | null): string {
  if (growthPct === null || growthPct === 0) return 'text-muted-foreground';
  return growthPct > 0 ? 'text-emerald-400' : 'text-rose-400';
}

function Tile({ label, metric }: { label: string; metric: GrowthMetric }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-display text-2xl text-foreground">
          {formatMetricValue(metric.current)}
        </p>
        <p className={cn('mt-1 font-mono text-xs', growthTone(metric.growthPct))}>
          {formatGrowthPct(metric.growthPct)}
        </p>
      </CardContent>
    </Card>
  );
}

// Period-over-period growth for exactly 4 top-line metrics - the same
// computeGrowthSummary() output the Analytics Report PDF also renders, so
// this dashboard and the PDF can never disagree on what "growth" means.
export function GrowthSummary({ growthSummary }: GrowthSummaryProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Total Views" metric={growthSummary.views} />
      <Tile label="Rata-rata Engagement" metric={growthSummary.engagementScore} />
      <Tile label="Total Video" metric={growthSummary.videos} />
      <Tile label="Total Klip" metric={growthSummary.clips} />
    </div>
  );
}
