import type { QueueName } from './job';

// Oracle Cloud Free hybrid deployment (PR #44, Queue & Worker Observability
// Dashboard) - the response shapes for apps/api's GET /queues and
// GET /workers/health, previously only defined locally inside
// apps/api/src/monitoring/monitoring.controller.ts and
// worker-heartbeat-reader.ts. Moved here so apps/web can import the exact
// same shape rather than re-declaring it - the same "one shared contract,
// not two independently-maintained copies" reasoning
// worker-heartbeat.ts (@speedora/shared) already documents for the
// heartbeat key/payload format.

// GET /queues - keyed by QueueName. failureRate/avgProcessingTimeMs are
// null when there's no completed/failed data yet for that queue (queue-
// metrics.ts) - "unknown", not "zero" or "instant".
export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  likelyStalled: number;
  failureRate: number | null;
  avgProcessingTimeMs: number | null;
  retriedJobs: number;
}

export type QueuesDto = Partial<Record<QueueName, QueueCounts>>;

// GET /workers - per-QUEUE connected BullMQ client count (not per-process -
// see GET /workers/health for that).
export type WorkersDto = Partial<Record<QueueName, { connected: number }>>;

// GET /workers/health - per-worker-PROCESS status, built from the Redis
// heartbeat each apps/worker process writes (workerHeartbeat.ts).
export interface WorkerHealthEntry {
  worker: string;
  queues: QueueName[];
  jobsActive: number;
  jobsWaiting: number;
  startedAt: string;
  heartbeatTtlSeconds: number;
}

export type WorkersHealthDto = WorkerHealthEntry[];
