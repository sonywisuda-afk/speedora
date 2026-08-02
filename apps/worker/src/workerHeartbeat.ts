import * as os from 'node:os';
import type { Redis } from 'ioredis';
import { heartbeatKey, type QueueName, type WorkerHeartbeatPayload } from '@speedora/shared';
import { forStage } from './logger';

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
const logger = forStage('worker-heartbeat');

// Defaults to hostname+pid so a heartbeat is never silently missing just
// because WORKER_ID wasn't set - but the Oracle worker-group compose files
// (docker-compose.oracle-worker-light.yml et al) always set it explicitly
// to a stable, human-meaningful id (e.g. "worker-render"), since a
// container's hostname is normally its random container id, not something
// an operator recognizes in GET /workers/health output.
export function resolveWorkerId(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKER_ID ?? `${os.hostname()}-${process.pid}`;
}

export class InvalidWorkerHeartbeatConfigError extends Error {}

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_TTL_SECONDS = 45;

function parsePositiveNumberEnv(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  // Number(<non-numeric>) is NaN, which `??` does NOT treat as nullish -
  // exactly the gap that let a malformed value silently reach
  // setInterval(fn, NaN) (fires effectively as fast as possible) before
  // this validation existed. Rejected here, at the same "fail loudly at
  // boot" point env.ts's validateEnv() already enforces for every other
  // var - not discovered later as Redis rejecting a NaN/negative TTL.
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidWorkerHeartbeatConfigError(
      `Invalid ${name} value: "${raw}". Must be a positive number.`,
    );
  }
  return value;
}

// Resolves and validates WORKER_HEARTBEAT_INTERVAL_MS/WORKER_HEARTBEAT_TTL_SECONDS
// from the environment - called by env.ts's validateEnv() (so a malformed
// value fails at boot, not silently inside the first setInterval tick) and
// by main.ts (to get the same validated values it actually starts the
// heartbeat with).
export function resolveHeartbeatOptions(
  env: NodeJS.ProcessEnv = process.env,
): Required<WorkerHeartbeatOptions> {
  const intervalMs =
    parsePositiveNumberEnv('WORKER_HEARTBEAT_INTERVAL_MS', env.WORKER_HEARTBEAT_INTERVAL_MS) ??
    DEFAULT_INTERVAL_MS;
  const ttlSeconds =
    parsePositiveNumberEnv('WORKER_HEARTBEAT_TTL_SECONDS', env.WORKER_HEARTBEAT_TTL_SECONDS) ??
    DEFAULT_TTL_SECONDS;

  // A TTL that expires before (or exactly when) the next beat would refresh
  // it defeats the "a couple missed beats is still fine" tolerance the
  // default 45s/15s ratio is built on - a healthy worker would flicker
  // "offline" in GET /workers/health between every single beat.
  if (ttlSeconds * 1000 <= intervalMs) {
    throw new InvalidWorkerHeartbeatConfigError(
      `WORKER_HEARTBEAT_TTL_SECONDS (${ttlSeconds}s) must be greater than ` +
        `WORKER_HEARTBEAT_INTERVAL_MS (${intervalMs}ms) - otherwise a healthy worker's ` +
        `heartbeat key could expire between beats.`,
    );
  }

  return { intervalMs, ttlSeconds };
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
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const key = heartbeatKey(workerId);
  const payload: WorkerHeartbeatPayload = {
    workerId,
    queues,
    startedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(payload);

  // Caught and logged locally, not left to become an unhandled promise
  // rejection - a transient Redis blip (or a restart of the web-api
  // instance this connects to) shouldn't crash the worker or depend
  // entirely on Sentry's global unhandledRejection handler to be noticed.
  // The next interval tick simply tries again; GET /workers/health's
  // consumer sees a shrinking TTL if beats keep failing, same signal as a
  // genuinely dead worker.
  const beat = async () => {
    try {
      await redis.set(key, serialized, 'EX', ttlSeconds);
    } catch (error) {
      logger.warn('heartbeat write failed, will retry next interval', { workerId }, error);
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref();

  return {
    // Deletes the key rather than waiting out the TTL, so a graceful
    // `docker stop`/rolling deploy is reflected in GET /workers/health
    // immediately instead of up to ttlSeconds late.
    stop: async () => {
      clearInterval(timer);
      try {
        await redis.del(key);
      } catch (error) {
        logger.warn('heartbeat key cleanup failed (will expire via TTL)', { workerId }, error);
      }
    },
  };
}
