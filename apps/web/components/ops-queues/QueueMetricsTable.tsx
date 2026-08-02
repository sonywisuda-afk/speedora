import type { QueueCounts, QueueName } from '@speedora/shared';
import { formatMillis } from '@/lib/dashboard';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface QueueMetricsTableProps {
  queues: Partial<Record<QueueName, QueueCounts>>;
}

// PR #44 (Queue & Worker Observability Dashboard) - one row per queue,
// sourced from GET /queues (monitoring.md). Sorted by (waiting + active)
// descending so the busiest queues surface first, rather than alphabetical
// order or QueueName's own declaration order, neither of which says
// anything about what an operator should look at first.
export function QueueMetricsTable({ queues }: QueueMetricsTableProps) {
  const rows = (Object.entries(queues) as [QueueName, QueueCounts][]).sort(
    ([, a], [, b]) => b.waiting + b.active - (a.waiting + a.active),
  );

  if (rows.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Tidak ada data queue.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Queue
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Waiting
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Active
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Completed
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Failed
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Failure Rate
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Avg. Time
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Retried
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Stalled
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, counts]) => (
            <tr key={name} className="border-b border-border/50">
              <td className="p-2 font-mono text-xs text-foreground">{name}</td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {counts.waiting}
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {counts.active}
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {counts.completed}
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {counts.failed}
              </td>
              <td className="p-2 text-right">
                <FailureRateBadge failureRate={counts.failureRate} />
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {formatMillis(counts.avgProcessingTimeMs)}
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {counts.retriedJobs}
              </td>
              <td className="p-2 text-right">
                {counts.likelyStalled > 0 ? (
                  <Badge variant="warning">{counts.likelyStalled}</Badge>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Thresholds are illustrative, not calibrated against production data -
// same "no data to calibrate against yet" posture
// packages/shared/src/utils/alert-conditions.ts's own DEFAULT_ALERT_THRESHOLDS
// documents. This is presentation only (which color a cell gets), not a new
// alert rule - it doesn't write anywhere, unlike alert-conditions.ts's
// predicates which GET /alerts actually evaluates.
function FailureRateBadge({ failureRate }: { failureRate: number | null }) {
  if (failureRate === null) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  }
  const pct = (failureRate * 100).toFixed(1);
  const variant = failureRate > 0.5 ? 'error' : failureRate > 0.2 ? 'warning' : 'muted';
  return (
    <Badge variant={variant} className={cn(variant === 'muted' && 'text-muted-foreground')}>
      {pct}%
    </Badge>
  );
}
