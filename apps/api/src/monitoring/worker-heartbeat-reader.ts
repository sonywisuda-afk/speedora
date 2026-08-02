import type { QueueName, WorkerHeartbeatPayload } from '@speedora/shared';
// PR #45 (Production Metrics Collection) - apps/worker/src/workers/
// metrics-snapshot.worker.ts needs to parse raw heartbeat values too now,
// not just this endpoint, so the parser itself moved to @speedora/shared
// (worker-heartbeat.ts) alongside the key format/payload shape it already
// lived next to. Re-exported here (not just imported-and-used) so this
// module's existing public surface (`import { parseHeartbeatPayload } from
// './worker-heartbeat-reader'`, used by monitoring.controller.ts) doesn't
// need to change at every call site.
export { parseHeartbeatPayload } from '@speedora/shared';

export interface WorkerHealthEntry {
  worker: string;
  queues: QueueName[];
  jobsActive: number;
  jobsWaiting: number;
  startedAt: string;
  heartbeatTtlSeconds: number;
}

// Pure - turns one heartbeat's payload + its Redis TTL + this queue's
// current active/waiting job counts into the shape GET /workers/health
// returns. Kept separate from MonitoringController's Redis/BullMQ fetching
// so this mapping is unit-testable without a real Queue/Redis - same
// "controller orchestrates, a plain function computes" split as
// packages/shared/src/utils/queue-metrics.ts.
export function buildWorkerHealthEntry(
  payload: WorkerHeartbeatPayload,
  ttlSeconds: number,
  jobCountsByQueue: ReadonlyMap<QueueName, { active: number; waiting: number }>,
): WorkerHealthEntry {
  let jobsActive = 0;
  let jobsWaiting = 0;
  for (const queueName of payload.queues) {
    const counts = jobCountsByQueue.get(queueName);
    if (counts) {
      jobsActive += counts.active;
      jobsWaiting += counts.waiting;
    }
  }

  return {
    worker: payload.workerId,
    queues: payload.queues,
    jobsActive,
    jobsWaiting,
    startedAt: payload.startedAt,
    heartbeatTtlSeconds: ttlSeconds,
  };
}
