import type { QueueName, WorkerHealthEntry, WorkerHeartbeatPayload } from '@speedora/shared';

// WorkerHealthEntry is defined in @speedora/shared (queue-monitoring.ts),
// not here - PR #44 (Queue & Worker Observability Dashboard) needs
// apps/web to consume the exact same shape this file produces, so it moved
// out of this file to avoid two independently-maintained copies of the
// same response shape (same reasoning worker-heartbeat.ts's own comment
// gives for the heartbeat key/payload format living in @speedora/shared).

// Parses one raw Redis GET result into a WorkerHeartbeatPayload, or null if
// it's missing/malformed. A heartbeat key can expire between
// MonitoringController.workersHealth()'s KEYS scan and its GET on that same
// key (a real, if narrow, race - TTL-based keys, see workerHeartbeat.ts) -
// this endpoint skips that one entry rather than 500ing the whole response
// over it.
export function parseHeartbeatPayload(raw: string | null): WorkerHeartbeatPayload | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Partial<WorkerHeartbeatPayload>).workerId === 'string' &&
      Array.isArray((parsed as Partial<WorkerHeartbeatPayload>).queues) &&
      typeof (parsed as Partial<WorkerHeartbeatPayload>).startedAt === 'string'
    ) {
      return parsed as WorkerHeartbeatPayload;
    }
    return null;
  } catch {
    return null;
  }
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
