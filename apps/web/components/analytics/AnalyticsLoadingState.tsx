export interface AnalyticsLoadingStateProps {
  message?: string;
}

// Sprint 6C.5 (Analytics UI Foundation) - same reasoning as
// AnalyticsEmptyState, for the "Memuat..." treatment used across analytics
// pages (e.g. /videos/:id/performance).
export function AnalyticsLoadingState({ message = 'Memuat data...' }: AnalyticsLoadingStateProps) {
  return <p className="font-body text-sm text-muted-foreground">{message}</p>;
}
