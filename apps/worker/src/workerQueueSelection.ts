import { QueueName } from '@speedora/shared';

const ALL_QUEUE_NAMES = new Set<string>(Object.values(QueueName));

export class InvalidWorkerQueuesError extends Error {}

// Oracle Cloud Free hybrid deployment (Fase 2) - WORKER_QUEUES lets one
// worker process run only a subset of the 16 queues, so "light", I/O-bound
// queues (transcribe, detect-clips, import-youtube, publish, notifications,
// sync-*, ...) and the CPU-heavy render-clip queue can run on separate hosts
// without any change to queue/producer code: every Queue producer instance
// in queues.ts is still created in every process regardless of this filter,
// so cross-queue self-chaining across hosts keeps working - a job just waits
// in Redis until whichever host's worker is subscribed to that queue name
// picks it up. Unset (the default) means "every queue", identical to
// pre-Fase-2 behavior - existing single-host deployments are unaffected.
export function parseWorkerQueues(raw: string | undefined): Set<QueueName> | null {
  if (raw === undefined || raw.trim() === '') return null;

  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const invalid = names.filter((name) => !ALL_QUEUE_NAMES.has(name));

  if (invalid.length > 0) {
    throw new InvalidWorkerQueuesError(
      `Invalid WORKER_QUEUES value(s): ${invalid.join(', ')}. Valid queue names: ${[...ALL_QUEUE_NAMES].sort().join(', ')}.`,
    );
  }
  if (names.length === 0) {
    throw new InvalidWorkerQueuesError('WORKER_QUEUES is set but contains no queue names.');
  }

  return new Set(names as QueueName[]);
}

export function isQueueEnabled(queueName: QueueName, enabled: Set<QueueName> | null): boolean {
  return enabled === null || enabled.has(queueName);
}

// Oracle Cloud Free hybrid deployment (Fase 3) - workerHeartbeat.ts needs the
// concrete queue list this process actually handles (for GET /workers/health
// to report), not the null-means-everything sentinel parseWorkerQueues()
// returns for the unset case. Order matches QueueName's own declaration
// order when enabled is null, and the caller's comma-separated order
// otherwise (Set preserves insertion order) - not meaningful, just stable.
export function resolveEffectiveQueues(enabled: Set<QueueName> | null): QueueName[] {
  return enabled === null ? (Object.values(QueueName) as QueueName[]) : [...enabled];
}
