'use client';

import type { LeaderboardRow } from '@speedora/shared';
import { AnalyticsBarChart } from './AnalyticsBarChart';
import { AnalyticsCard } from './AnalyticsCard';

export interface LeaderboardBarPanelProps {
  title: string;
  rows: LeaderboardRow[];
  valueLabel: string;
  emptyMessage: string;
}

const ROW_HEIGHT = 36;
const MIN_HEIGHT = 160;

// Sprint 6D (Leaderboard) - one small composition of AnalyticsCard +
// AnalyticsBarChart, reused for all 4 dimensions (Top Clip/Creator/
// Campaign/Platform) rather than repeating the same wiring 4 times on the
// page. Horizontal bars (layout="vertical", per AnalyticsBarChart's own
// naming) - the natural shape for a ranked list. Height scales with row
// count so a Top 20 list doesn't cram into the same fixed height as Top 5.
export function LeaderboardBarPanel({ title, rows, valueLabel, emptyMessage }: LeaderboardBarPanelProps) {
  return (
    <AnalyticsCard title={title}>
      <AnalyticsBarChart
        data={rows}
        categoryKey="label"
        valueKey="value"
        valueLabel={valueLabel}
        layout="vertical"
        tooltipFormatter={(row) => [
          { label: valueLabel, value: row.value.toLocaleString() },
          ...(row.secondaryLabel ? [{ label: 'Info', value: row.secondaryLabel }] : []),
        ]}
        height={Math.max(MIN_HEIGHT, rows.length * ROW_HEIGHT)}
        isEmpty={rows.length === 0}
        emptyMessage={emptyMessage}
      />
    </AnalyticsCard>
  );
}
