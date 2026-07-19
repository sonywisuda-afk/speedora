import type { ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';
import { AnalyticsEmptyState } from './AnalyticsEmptyState';

export interface AnalyticsChartContainerProps {
  height?: number;
  isEmpty: boolean;
  emptyMessage: string;
  children: ReactElement;
}

// Sprint 6C.5 (Analytics UI Foundation) - the fixed-height
// ResponsiveContainer shell + "no data" branch every Recharts chart needs,
// factored out of Sprint 6B's TrendChart so AnalyticsLineChart/
// AnalyticsBarChart (and any future chart) don't each reimplement it.
// Deliberately just this - no registry, no chart-type switch. A chart
// component passes its own Recharts element as `children`.
export function AnalyticsChartContainer({
  height = 256,
  isEmpty,
  emptyMessage,
  children,
}: AnalyticsChartContainerProps) {
  if (isEmpty) {
    return <AnalyticsEmptyState message={emptyMessage} />;
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
