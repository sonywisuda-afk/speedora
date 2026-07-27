import type { AnalyticsOverviewDto } from '@speedora/shared';
import { Badge } from '@/components/ui/badge';
import { videoStatusBadge } from '@/lib/analytics';

export interface ProcessingStatusBreakdownProps {
  processingStatus: AnalyticsOverviewDto['processingStatus'];
}

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-success/40 text-success',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-destructive/40 text-destructive',
};

// Badge row, not a bar chart - 6 categories at typically low counts read
// better as labeled badges than as a bar strip, same reasoning
// VideoAnalysisDashboard.tsx already uses for its topic/intent
// distribution.
export function ProcessingStatusBreakdown({ processingStatus }: ProcessingStatusBreakdownProps) {
  if (processingStatus.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Belum ada video.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {processingStatus.map((entry) => {
        const badge = videoStatusBadge(entry.status);
        return (
          <Badge key={entry.status} variant="outline" className={TONE_CLASSES[badge.tone]}>
            {badge.label} × {entry.count}
          </Badge>
        );
      })}
    </div>
  );
}
