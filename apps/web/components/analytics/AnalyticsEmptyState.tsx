export interface AnalyticsEmptyStateProps {
  message: string;
}

// Sprint 6C.5 (Analytics UI Foundation) - the one "no data" text treatment
// every analytics chart/table used ad hoc (EngagementTrendChart,
// TrendChart, TopClipsTable, ClipPerformanceHistoryTable, ...). Centralized
// so it can't drift between components, and so a future visual tweak is a
// one-file change.
export function AnalyticsEmptyState({ message }: AnalyticsEmptyStateProps) {
  return <p className="font-body text-sm text-muted-foreground">{message}</p>;
}
