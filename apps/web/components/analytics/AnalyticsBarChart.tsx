'use client';

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsChartContainer } from './AnalyticsChartContainer';
import { AnalyticsTooltip, type AnalyticsTooltipRow } from './AnalyticsTooltip';

// Generic over the caller's own row type (T), same reasoning as
// AnalyticsLineChartProps - a concrete DTO shape isn't structurally
// assignable to Record<string, unknown> without an explicit index signature.
export interface AnalyticsBarChartProps<T> {
  data: T[];
  categoryKey: Extract<keyof T, string>;
  valueKey: Extract<keyof T, string>;
  valueLabel: string;
  color?: string;
  // Recharts' own naming: layout="vertical" draws bars horizontally
  // (category axis on Y) - the shape a ranked list (Sprint 6D's Leaderboard)
  // wants. 'horizontal' (Recharts' default) draws upright bars, category on
  // X - the shape a small category comparison wants. Named after Recharts'
  // own prop rather than invented terms, since this is a thin pass-through,
  // not a new abstraction.
  layout?: 'horizontal' | 'vertical';
  tooltipFormatter?: (point: T) => AnalyticsTooltipRow[];
  height?: number;
  emptyMessage: string;
  isEmpty: boolean;
}

const DEFAULT_BAR_COLOR = '#22E6D6'; // signal-cyan

// Sprint 6C.5 (Analytics UI Foundation) - a thin Recharts BarChart wrapper,
// sibling to AnalyticsLineChart. Single-hue by design (magnitude, not
// identity - per the dataviz skill, a ranked single-metric list doesn't
// need categorical color); rounded data-ends anchored to the baseline (4px
// radius on the far-from-axis corners only, matching the skill's mark
// spec), recessive grid/axis, hover tooltip. First real consumer is Sprint
// 6D's Leaderboard.
export function AnalyticsBarChart<T extends object>({
  data,
  categoryKey,
  valueKey,
  valueLabel,
  color = DEFAULT_BAR_COLOR,
  layout = 'vertical',
  tooltipFormatter,
  height,
  emptyMessage,
  isEmpty,
}: AnalyticsBarChartProps<T>) {
  const isHorizontalBars = layout === 'vertical';

  return (
    <AnalyticsChartContainer height={height} isEmpty={isEmpty} emptyMessage={emptyMessage}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          horizontal={!isHorizontalBars}
          vertical={isHorizontalBars}
        />
        {isHorizontalBars ? (
          <>
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey={categoryKey}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={96}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={categoryKey}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
          </>
        )}
        <Tooltip
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as T | undefined;
            const rows = point
              ? (tooltipFormatter?.(point) ?? [
                  { label: valueLabel, value: String(point[valueKey] ?? '—') },
                ])
              : [];
            return <AnalyticsTooltip active={active} rows={rows} />;
          }}
          cursor={{ fill: 'hsl(var(--accent))' }}
        />
        <Bar
          dataKey={valueKey}
          name={valueLabel}
          fill={color}
          radius={isHorizontalBars ? [0, 4, 4, 0] : [4, 4, 0, 0]}
        />
      </BarChart>
    </AnalyticsChartContainer>
  );
}
