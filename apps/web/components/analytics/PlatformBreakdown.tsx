import type { AnalyticsOverviewDto } from '@speedora/shared';
import { PLATFORM_LABELS, toBarPercent } from '@/lib/analytics';

export interface PlatformBreakdownProps {
  breakdown: AnalyticsOverviewDto['platformBreakdown'];
}

// Small horizontal bar-per-platform - same percentage-width-bar technique
// as VideoAnalysisDashboard.tsx's average-score bars. Only 3 categories
// (YouTube/TikTok/Instagram), so a bar list reads better than a pie/donut
// at this size.
export function PlatformBreakdown({ breakdown }: PlatformBreakdownProps) {
  if (breakdown.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">Belum ada klip yang dipublikasikan.</p>
    );
  }

  const max = Math.max(...breakdown.map((b) => b.publishedCount));

  return (
    <div className="space-y-2">
      {breakdown.map((entry) => (
        <div key={entry.platform} className="flex items-center gap-2">
          <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {PLATFORM_LABELS[entry.platform]}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${toBarPercent(entry.publishedCount, max)}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-primary">
            {entry.publishedCount}
          </span>
        </div>
      ))}
    </div>
  );
}
