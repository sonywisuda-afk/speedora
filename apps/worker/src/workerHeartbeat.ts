import * as os from 'node:os';
import type { Redis } from 'ioredis';
import { heartbeatKey, type QueueName, type WorkerHeartbeatPayload } from '@speedora/shared';

// Oracle Cloud Free hybrid deployment (Fase 3) - lets apps/api's
// GET /workers/health report on individual worker PROCESSES (e.g. "which
// queues is the render-only VM actually running, and is it still alive"),
// which BullMQ's own per-queue connected-client count (GET /workers) can't
// answer - that endpoint says "N clients are connected to queue X", not
// "here is worker process Y and everything it's responsible for".
// apps/worker has no HTTP server of its own (see CLAUDE.md) - a
// Redis-backed heartbeat that apps/api reads back is the same
// "cross-process state via Redis/Postgres, not a new HTTP surface" shape as
// video-import-metrics.ts and the AlertState-in-Postgres pattern GET /alerts
// already uses. The key format/payload shape live in @speedora/shared
// (worker-heartbeat.ts), not here, since apps/api's reader depends on the
// exact same contract - see that file's own comment.

// Defaults to hostname+pid so a heartbeat is never silently missing just
// because WORKER_ID wasn't set - but the Oracle worker-group compose files
// (docker-compose.oracle-worker-light.yml et al) always set it explicitly
// to a stable, human-meaningful id (e.g. "worker-render"), since a
// container's hostname is normally its random container id, not something
// an operator recognizes in GET /workers/health output.
export function resolveWorkerId(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKER_ID ?? `${os.hostname()}-${process.pid}`;
}

export interface WorkerHeartbeatHandle {
  stop(): Promise<void>;
}

export interface WorkerHeartbeatOptions {
  intervalMs?: number;
  ttlSeconds?: number;
}

// TTL, not a plain SET - a worker that crashes (SIGKILL, host loss) rather
// than shutting down gracefully leaves no chance to delete its own key, so
// "the key exists" only means "presumed alive" if it also expires on its
// own. ttlSeconds is deliberately a few heartbeat intervals wide (see
// startWorkerHeartbeat's defaults) so one missed beat under load doesn't
// flip a healthy worker to "offline" in GET /workers/health.
export function startWorkerHeartbeat(
  redis: Redis,
  workerId: string,
  queues: QueueName[],
  options: WorkerHeartbeatOptions = {},
): WorkerHeartbeatHandle {
  const intervalMs = options.intervalMs ?? 15_000;
  const ttlSeconds = options.ttlSeconds ?? 45;
  const key = heartbeatKey(workerId);
  const payload: WorkerHeartbeatPayload = {
    workerId,
    queues,
    startedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(payload);

  const beat = () => redis.set(key, serialized, 'EX', ttlSeconds);

  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref();

  return {
    // Deletes the key rather than waiting out the TTL, so a graceful
    // `docker stop`/rolling deploy is reflected in GET /workers/health
    // immediately instead of up to ttlSeconds late.
    stop: async () => {
      clearInterval(timer);
      await redis.del(key);
    },
  };
}
