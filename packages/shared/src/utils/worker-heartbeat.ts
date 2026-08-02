import { QueueName } from '../types/job';

// Oracle Cloud Free hybrid deployment (Fase 3 - Health Endpoint) - the key
// format and payload shape both apps/worker (writer,
// apps/worker/src/workerHeartbeat.ts) and apps/api (reader,
// apps/api/src/monitoring/worker-heartbeat-reader.ts) depend on. Lives here,
// not duplicated in both apps, for the same reason QueueName itself does -
// two independently-maintained copies of the same string format is exactly
// the kind of drift CLAUDE.md's coding-standards doc warns about elsewhere
// (see the ActivityEventType incident referenced there).
const HEARTBEAT_KEY_PREFIX = 'speedora:worker:heartbeat:';

export function heartbeatKey(workerId: string): string {
  return `${HEARTBEAT_KEY_PREFIX}${workerId}`;
}

export function heartbeatKeyPattern(): string {
  return `${HEARTBEAT_KEY_PREFIX}*`;
}

export interface WorkerHeartbeatPayload {
  workerId: string;
  queues: QueueName[];
  startedAt: string;
}

// PR #45 (Production Metrics Collection) - a second consumer,
// apps/worker/src/workers/metrics-snapshot.worker.ts, needs to parse raw
// heartbeat values too (not just apps/api's GET /workers/health), so this
// moved here alongside the format it parses rather than staying a private
// helper of apps/api/src/monitoring/worker-heartbeat-reader.ts. Returns
// null for a missing/malformed value rather than throwing - a heartbeat key
// can expire between a Redis KEYS scan and the GET on that same key (both
// TTL-based), and every caller of this function treats that as "skip this
// one entry", not a fatal error.
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
