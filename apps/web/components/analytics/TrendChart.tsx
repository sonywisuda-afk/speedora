'use client';

import type { EngagementTrendPoint, TrendGranularity } from '@speedora/shared';
import { cn } from '@/lib/utils';
import { AnalyticsLineChart } from './AnalyticsLineChart';
import type { AnalyticsTooltipRow } from './AnalyticsTooltip';

export interface TrendChartProps {
  data: EngagementTrendPoint[];
  granularity: TrendGranularity;
  onGranularityChange: (granularity: TrendGranularity) => void;
  // Single-series by design (dataviz skill's form heuristic: one measure
  // over time is a line chart, one hue, no legend needed - the panel title
  // names the series). Defaults to totalViews, the same primary metric
  // EngagementTrendChart.tsx already uses; future trend surfaces
  // (Followers, Revenue) pass their own key/label into the same component
  // rather than forking a new chart.
  seriesKey?: 'totalViews' | 'averageEngagementScore' | 'publishCount';
  seriesLabel?: string;
}

const GRANULARITY_OPTIONS: Array<{ value: TrendGranularity; label: string }> = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'yearly', label: 'Tahunan' },
];

// Sprint 6B (Trend granularity), rebuilt in Sprint 6C.5 on top of
// AnalyticsLineChart/AnalyticsTooltip (Analytics UI Foundation) instead of
// its own inline Recharts markup - the first real proof the new foundation
// works for an actual caller, not just built in isolation.
// EngagementTrendChart.tsx (the existing hand-rolled SVG bar chart) is left
// untouched; this is still an additive "Trend" panel with its own
// Daily/Weekly/Monthly/Yearly control, not a replacement.
export function TrendChart({
  data,
  granularity,
  onGranularityChange,
  seriesKey = 'totalViews',
  seriesLabel = 'Views',
}: TrendChartProps) {
  const hasData = data.some((d) => d.publishCount > 0);

  function tooltipFormatter(point: EngagementTrendPoint): AnalyticsTooltipRow[] {
    return [
      { label: seriesLabel, value: String(point[seriesKey]) },
      { label: 'Publikasi', value: `${point.publishCount}` },
    ];
  }

  return (
    <div>
      <div className="flex justify-end gap-1">
        {GRANULARITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onGranularityChange(option.value)}
            aria-current={granularity === option.value ? 'true' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 font-mono text-xs transition-colors',
              granularity === option.value
                ? 'bg-slate-panel font-medium text-signal-pink'
                : 'text-muted-foreground hover:bg-slate-panel/60 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        <AnalyticsLineChart
          data={data}
          xKey="date"
          series={[{ key: seriesKey, label: seriesLabel }]}
          tooltipTitle={(point) => String(point.date)}
          tooltipFormatter={tooltipFormatter}
          isEmpty={!hasData}
          emptyMessage="Belum ada publikasi pada rentang waktu ini."
        />
      </div>
    </div>
  );
}
