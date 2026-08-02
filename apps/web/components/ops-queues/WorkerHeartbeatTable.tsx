import type { WorkerHealthEntry } from '@speedora/shared';
import { formatRelativeTime } from '@/lib/dashboard';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface WorkerHeartbeatTableProps {
  workers: WorkerHealthEntry[];
}

// PR #44 (Queue & Worker Observability Dashboard) - one row per worker
// PROCESS (not per queue - see QueueMetricsTable for that), sourced from
// GET /workers/health. A worker whose heartbeat has expired simply isn't in
// this list at all (its Redis key is gone) - there's no "offline" row to
// render, only absence, same as the underlying endpoint (monitoring.md).
export function WorkerHeartbeatTable({ workers }: WorkerHeartbeatTableProps) {
  if (workers.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Tidak ada worker dengan heartbeat aktif saat ini.
      </p>
    );
  }

  const sorted = [...workers].sort((a, b) => a.worker.localeCompare(b.worker));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Worker
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Queues
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Active
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Waiting
            </th>
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Started
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Heartbeat
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((worker) => (
            <tr key={worker.worker} className="border-b border-border/50">
              <td className="p-2 font-mono text-xs text-foreground">{worker.worker}</td>
              <td className="p-2">
                <QueueBadgeList queues={worker.queues} />
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {worker.jobsActive}
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {worker.jobsWaiting}
              </td>
              <td className="p-2 font-mono text-xs text-muted-foreground">
                {formatRelativeTime(worker.startedAt)}
              </td>
              <td className="p-2 text-right">
                <HeartbeatFreshnessBadge ttlSeconds={worker.heartbeatTtlSeconds} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Truncated at 4 with a "+N" overflow badge - a "light" role worker
// (docker-compose.oracle-worker-light.yml) lists 13 queues, which would
// otherwise blow out the row height for every other worker in the table.
function QueueBadgeList({ queues }: { queues: string[] }) {
  const VISIBLE = 4;
  const shown = queues.slice(0, VISIBLE);
  const overflow = queues.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((queue) => (
        <Badge key={queue} variant="outline">
          {queue}
        </Badge>
      ))}
      {overflow > 0 ? <Badge variant="muted">+{overflow}</Badge> : null}
    </div>
  );
}

// Illustrative freshness read on the TTL, not a real alert condition (that
// would need the configured WORKER_HEARTBEAT_INTERVAL_MS/TTL_SECONDS this
// response doesn't expose) - assumes roughly the documented defaults
// (15s interval / 45s TTL, workerHeartbeat.ts). A healthy worker's TTL
// oscillates between ~30s (just before the next beat resets it) and 45s
// (just after); one missed beat drops it under that floor.
function HeartbeatFreshnessBadge({ ttlSeconds }: { ttlSeconds: number }) {
  const variant = ttlSeconds > 25 ? 'success' : ttlSeconds > 10 ? 'warning' : 'error';
  const label = ttlSeconds > 25 ? 'Healthy' : ttlSeconds > 10 ? 'Degraded' : 'Stale';
  return (
    <Badge variant={variant} className={cn('gap-1')}>
      {label}
      <span className="text-muted-foreground">· {ttlSeconds}s</span>
    </Badge>
  );
}
