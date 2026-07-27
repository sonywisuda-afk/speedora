import type { HistogramBucket } from '@speedora/shared';
import { toBarPercent } from '@/lib/ops-ai';

export interface HistogramBarsProps {
  bars: HistogramBucket[];
}

// Milestone 5C-B - the bucket-bar technique Milestone 5B's AiPerformanceSummary
// first used inline for its confidence distribution, generalized here since
// M5C-A/5C-B now need the identical treatment for TWO histograms (score and
// confidence) rather than one.
export function HistogramBars({ bars }: HistogramBarsProps) {
  const max = Math.max(...bars.map((b) => b.count), 1);

  return (
    <div className="space-y-1.5">
      {bars.map((bucket) => (
        <div key={bucket.bucket} className="flex items-center gap-2">
          <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
            {bucket.bucket}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-ai"
              style={{ width: `${toBarPercent(bucket.count, max)}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right font-mono text-[10px] text-ai">
            {bucket.count}
          </span>
        </div>
      ))}
    </div>
  );
}
