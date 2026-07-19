'use client';

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsChartContainer } from './AnalyticsChartContainer';
import { AnalyticsTooltip, type AnalyticsTooltipRow } from './AnalyticsTooltip';

export interface AnalyticsLineSeries {
  key: string;
  label: string;
  // Optional - single-series callers (most of them today) get this app's
  // established primary-metric color for free. Multi-series callers must
  // supply their own colors explicitly - this wrapper does not auto-cycle
  // hues (the dataviz skill's categorical-hue rule needs a validated fixed
  // order, which this app doesn't have beyond its 2 named signal colors
  // yet - a decision for whichever chart first needs 3+ series, not this
  // foundation).
  color?: string;
}

// Generic over the caller's own row type (T) rather than
// `Record<string, unknown>` - a concrete DTO shape like EngagementTrendPoint
// isn't structurally assignable to Record<string, unknown> (TS requires an
// explicit index signature for that), so a fixed non-generic prop type would
// force every caller to cast. Genericizing keeps this a thin pass-through.
export interface AnalyticsLineChartProps<T> {
  data: T[];
  xKey: Extract<keyof T, string>;
  series: AnalyticsLineSeries[];
  tooltipFormatter: (point: T) => AnalyticsTooltipRow[];
  tooltipTitle?: (point: T) => string;
  height?: number;
  emptyMessage: string;
  isEmpty: boolean;
}

const DEFAULT_SERIES_COLOR = '#22E6D6'; // signal-cyan

// Sprint 6C.5 (Analytics UI Foundation) - a thin Recharts LineChart wrapper
// generalized from Sprint 6B's TrendChart (magnitude-over-time, one hue per
// series, 2px line, no dot until hover, recessive grid/axis, hover
// tooltip - per the dataviz skill's line-chart mark spec). TrendChart itself
// is rebuilt on top of this in the same sprint, as the proof this contract
// actually works for a real caller before 6D/6E depend on it.
export function AnalyticsLineChart<T extends object>({
  data,
  xKey,
  series,
  tooltipFormatter,
  tooltipTitle,
  height,
  emptyMessage,
  isEmpty,
}: AnalyticsLineChartProps<T>) {
  return (
    <AnalyticsChartContainer height={height} isEmpty={isEmpty} emptyMessage={emptyMessage}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey={xKey}
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
        <Tooltip
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as T | undefined;
            return (
              <AnalyticsTooltip
                active={active}
                title={point && tooltipTitle ? tooltipTitle(point) : undefined}
                rows={point ? tooltipFormatter(point) : []}
              />
            );
          }}
          cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? DEFAULT_SERIES_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: s.color ?? DEFAULT_SERIES_COLOR }}
          />
        ))}
      </LineChart>
    </AnalyticsChartContainer>
  );
}
