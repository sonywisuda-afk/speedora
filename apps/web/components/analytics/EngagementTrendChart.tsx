import type { EngagementTrendPoint } from '@speedora/shared';
import { formatEngagementScore, formatShortDate, toBarPercent } from '@/lib/analytics';

export interface EngagementTrendChartProps {
  engagementTrend: EngagementTrendPoint[];
}

// Same bar-per-day technique as UploadTrendChart.tsx (M5A) - totalViews is
// the bar height (the primary series), publishCount/averageEngagementScore
// ride along in the hover tooltip. One clear chart rather than three
// competing bar heights in the same strip.
export function EngagementTrendChart({ engagementTrend }: EngagementTrendChartProps) {
  if (engagementTrend.every((d) => d.publishCount === 0)) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum ada publikasi pada rentang waktu ini.
      </p>
    );
  }

  const max = Math.max(...engagementTrend.map((d) => d.totalViews));

  return (
    <div className="flex h-24 items-end gap-[2px]">
      {engagementTrend.map((day) => (
        <div
          key={day.date}
          className="min-w-[2px] flex-1 rounded-t-sm bg-primary transition-opacity hover:opacity-80"
          style={{
            height: `${Math.max(toBarPercent(day.totalViews, max), day.publishCount > 0 ? 4 : 0)}%`,
          }}
          title={`${formatShortDate(day.date)}: ${day.totalViews} views, ${day.publishCount} publikasi, engagement rata-rata ${formatEngagementScore(day.averageEngagementScore)}`}
        />
      ))}
    </div>
  );
}
