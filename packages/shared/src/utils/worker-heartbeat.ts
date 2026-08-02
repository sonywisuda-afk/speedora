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
