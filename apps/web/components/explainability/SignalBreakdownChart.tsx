'use client';

import type { FusionBreakdown } from '@speedora/shared';
import { Badge } from '@/components/ui/badge';
import { groupBreakdownBySignal, toPercent } from '@/lib/explainability';
import { cn } from '@/lib/utils';

export interface SignalBreakdownChartProps {
  breakdown: FusionBreakdown;
}

// Per-signal grouped bars - same percentage-width-div technique as
// VideoAnalysisDashboard.tsx's average-score bars. Bar width is
// averageNormalizedValue (0-100%, the signal's own raw strength), not
// weightedContribution (a much smaller, weight-scaled number that would
// make a misleading bar) - see lib/explainability.ts's SignalGroup comment.
// A weight-0 ("not yet calibrated") signal is shown at reduced
// opacity/muted color plus a "Belum dibobotkan" badge, not hidden - the
// same transparency the Fusion Engine's own contributions array provides.
export function SignalBreakdownChart({ breakdown }: SignalBreakdownChartProps) {
  const groups = groupBreakdownBySignal(breakdown);

  if (groups.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum ada data sinyal untuk klip ini.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.signal}>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {group.signal}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full',
                  group.active ? 'bg-ai' : 'bg-muted-foreground/40',
                )}
                style={{ width: `${toPercent(group.averageNormalizedValue)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-[10px] text-ai">
              {toPercent(group.averageNormalizedValue)}%
            </span>
            {!group.active ? (
              <Badge variant="muted" className="shrink-0 whitespace-nowrap text-[9px]">
                Belum dibobotkan
              </Badge>
            ) : null}
          </div>
          <div className="ml-[7.5rem] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {group.features.map((feature) => (
              <span key={feature.feature} className="font-mono text-[10px] text-muted-foreground">
                {feature.feature}: {toPercent(feature.normalizedValue)}%
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
