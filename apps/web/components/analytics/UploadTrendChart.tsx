import type { AnalyticsOverviewDto } from '@speedora/shared';
import { formatShortDate, toBarPercent } from '@/lib/analytics';

export interface UploadTrendChartProps {
  uploadTrend: AnalyticsOverviewDto['uploadTrend'];
}

// A bar-per-day strip, not a line chart - no charting library exists
// anywhere in this app (same finding as Milestone 4), and a hand-rolled
// SVG line is meaningfully more complex than the bar techniques already
// used everywhere else here. Also arguably more honest for sparse daily
// counts than a line, which would visually imply continuity between
// non-adjacent points.
export function UploadTrendChart({ uploadTrend }: UploadTrendChartProps) {
  if (uploadTrend.every((d) => d.count === 0)) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum ada upload dalam 30 hari terakhir.
      </p>
    );
  }

  const max = Math.max(...uploadTrend.map((d) => d.count));

  return (
    <div className="flex h-24 items-end gap-[2px]">
      {uploadTrend.map((day) => (
        <div
          key={day.date}
          className="min-w-[2px] flex-1 rounded-t-sm bg-primary transition-opacity hover:opacity-80"
          style={{ height: `${Math.max(toBarPercent(day.count, max), day.count > 0 ? 4 : 0)}%` }}
          title={`${formatShortDate(day.date)}: ${day.count} upload`}
        />
      ))}
    </div>
  );
}
