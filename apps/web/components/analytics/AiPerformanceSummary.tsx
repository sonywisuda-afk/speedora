import type { AiPerformanceSummary as AiPerformanceSummaryDto } from '@speedora/shared';
import { formatConfidence } from '@/lib/explainability';
import { Badge } from '@/components/ui/badge';
import { HistogramBars } from '@/components/ops-ai/HistogramBars';
import { SignalContributionChart } from '@/components/ops-ai/SignalContributionChart';
import { StatTile } from './StatTile';

export interface AiPerformanceSummaryProps {
  summary: AiPerformanceSummaryDto;
}

// Milestone 5B's deliberately light preview of Milestone 5C's deeper AI
// Analytics stage - "Ini mulai menghubungkan analytics dengan
// explainability" (the user's own framing), not the full histogram/
// correlation build M5C owns. Reuses Milestone 4's formatConfidence()
// (same "heuristic, not calibrated" honesty). Milestone 5C-A adds Highlight
// Score Distribution + per-signal Contribution %, both scoped to this
// user's own clips (contrast with /ops/ai, which pools every user's clips
// for statistical power) - reuses the same HistogramBars/
// SignalContributionChart components /ops/ai uses, generalized out of this
// component's own original inline bucket-bar JSX.
export function AiPerformanceSummary({ summary }: AiPerformanceSummaryProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="Rata-rata Highlight Score"
          value={
            summary.averageHighlightScore !== null
              ? String(Math.round(summary.averageHighlightScore))
              : '—'
          }
        />
        <StatTile
          label="Rata-rata Confidence"
          value={formatConfidence(summary.averageConfidence)}
        />
      </div>

      <div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Distribusi Highlight Score
        </p>
        <div className="mt-2">
          <HistogramBars bars={summary.scoreDistribution} />
        </div>
      </div>

      <div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Distribusi Confidence
        </p>
        <div className="mt-2">
          <HistogramBars bars={summary.confidenceDistribution} />
        </div>
      </div>

      {summary.signalContributions.length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Kontribusi Sinyal
          </p>
          <div className="mt-2">
            <SignalContributionChart signals={summary.signalContributions} />
          </div>
        </div>
      ) : null}

      {summary.mostCommonSignals.length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Sinyal Paling Sering Muncul
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.mostCommonSignals.map((entry) => (
              <Badge key={entry.signal} variant="outline">
                {entry.signal} × {entry.count}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {summary.topHighlightReasons.length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Alasan Highlight Teratas
          </p>
          <ul className="mt-2 space-y-2">
            {summary.topHighlightReasons.map((entry) => (
              <li key={entry.clipId} className="flex items-start gap-2">
                <span className="shrink-0 font-mono text-xs text-ai">
                  {entry.highlightScore !== null ? Math.round(entry.highlightScore) : '—'}
                </span>
                <span className="font-body text-sm text-foreground">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
