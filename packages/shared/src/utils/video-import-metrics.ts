// Cross-process metrics store for the video import subsystem
// (@speedora/video-import-engine). apps/worker and apps/api are separate
// Node processes, so in-memory counters (like this codebase's existing
// metrics-registry.ts HTTP counters) don't work here - the worker records an
// outcome after every import, and apps/api's GET /metrics reads the same
// keys back out. Lives in packages/shared (not video-import-engine, which
// stays Redis-free) - same "shared, non-Prisma, cross-app utility" role as
// alert-conditions.ts.
//
// Mirrors @speedora/contracts's ImportFailureCategory locally rather than
// importing it - packages/shared deliberately avoids depending on
// packages/contracts (see types/video.ts's own comment on the same rule).
export type ImportFailureCategory =
  | 'network'
  | 'extractor'
  | 'unavailable'
  | 'private'
  | 'age_restricted'
  | 'rate_limited'
  | 'unsupported'
  | 'timeout'
  | 'cancelled'
  | 'storage'
  | 'internal';

export type EngineHealthStatus = 'healthy' | 'stale' | 'unreachable';

// Structural, not a real ioredis import - satisfied by both
// createRedisConnection()'s ioredis instance (apps/worker) and a BullMQ
// Queue's own `.client` (apps/api's MonitoringController already uses this
// for its own Redis health check), so no new Redis connection or dependency
// is needed in either app.
export interface RedisLike {
  incr(key: string): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  hincrby(key: string, field: string, amount: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
}

export interface VideoImportOutcomeEvent {
  outcome: 'success' | 'failure';
  category?: ImportFailureCategory;
  durationMs: number;
  retries: number;
  timedOut: boolean;
  cancelled: boolean;
  engineName: string;
  engineVersion: string | null;
  engineHealthStatus: EngineHealthStatus;
}

export interface VideoImportMetricsSnapshot {
  totalImports: number;
  successfulImports: number;
  failedImports: number;
  successRate: number | null;
  retryCount: number;
  avgDurationMs: number | null;
  timeoutCount: number;
  cancellationCount: number;
  failuresByCategory: Partial<Record<ImportFailureCategory, number>>;
  engineName: string | null;
  engineVersion: string | null;
  engineHealthStatus: EngineHealthStatus | null;
  lastSuccessfulImportAt: string | null;
}

// No TTL on any of these - ephemeral operational state (same status as
// BullMQ's own Redis-backed job data, see docs/redis.md), not something that
// needs to survive a restart/flush unrecoverably. Unlike the process-local
// metrics-registry.ts HTTP counters, these are correct across worker
// restarts and multiple worker replicas since INCR/HINCRBY are atomic.
const KEYS = {
  total: 'speedora:video-import:total',
  success: 'speedora:video-import:success',
  failed: 'speedora:video-import:failed',
  retries: 'speedora:video-import:retries',
  timeouts: 'speedora:video-import:timeouts',
  cancellations: 'speedora:video-import:cancellations',
  durationSum: 'speedora:video-import:duration:sum',
  durationCount: 'speedora:video-import:duration:count',
  failuresByCategory: 'speedora:video-import:failuresByCategory',
  engineName: 'speedora:video-import:engine:name',
  engineVersion: 'speedora:video-import:engine:version',
  engineHealthStatus: 'speedora:video-import:engine:healthStatus',
  lastSuccessAt: 'speedora:video-import:lastSuccessAt',
} as const;

export async function recordVideoImportOutcome(
  redis: RedisLike,
  event: VideoImportOutcomeEvent,
): Promise<void> {
  await redis.incr(KEYS.total);
  await redis.incrby(KEYS.retries, event.retries);
  await redis.incrby(KEYS.durationSum, Math.round(event.durationMs));
  await redis.incr(KEYS.durationCount);

  if (event.outcome === 'success') {
    await redis.incr(KEYS.success);
    await redis.set(KEYS.lastSuccessAt, new Date().toISOString());
  } else {
    await redis.incr(KEYS.failed);
    if (event.timedOut) await redis.incr(KEYS.timeouts);
    if (event.cancelled) await redis.incr(KEYS.cancellations);
    if (event.category) await redis.hincrby(KEYS.failuresByCategory, event.category, 1);
  }

  await redis.set(KEYS.engineName, event.engineName);
  if (event.engineVersion) await redis.set(KEYS.engineVersion, event.engineVersion);
  await redis.set(KEYS.engineHealthStatus, event.engineHealthStatus);
}

async function readInt(redis: RedisLike, key: string): Promise<number> {
  const value = await redis.get(key);
  return value ? Number(value) : 0;
}

export async function readVideoImportMetrics(
  redis: RedisLike,
): Promise<VideoImportMetricsSnapshot> {
  const [
    total,
    success,
    failed,
    retries,
    timeouts,
    cancellations,
    durationSum,
    durationCount,
    failuresByCategoryRaw,
    engineName,
    engineVersion,
    engineHealthStatus,
    lastSuccessfulImportAt,
  ] = await Promise.all([
    readInt(redis, KEYS.total),
    readInt(redis, KEYS.success),
    readInt(redis, KEYS.failed),
    readInt(redis, KEYS.retries),
    readInt(redis, KEYS.timeouts),
    readInt(redis, KEYS.cancellations),
    readInt(redis, KEYS.durationSum),
    readInt(redis, KEYS.durationCount),
    redis.hgetall(KEYS.failuresByCategory),
    redis.get(KEYS.engineName),
    redis.get(KEYS.engineVersion),
    redis.get(KEYS.engineHealthStatus),
    redis.get(KEYS.lastSuccessAt),
  ]);

  const failuresByCategory: Partial<Record<ImportFailureCategory, number>> = {};
  for (const [category, count] of Object.entries(failuresByCategoryRaw)) {
    failuresByCategory[category as ImportFailureCategory] = Number(count);
  }

  return {
    totalImports: total,
    successfulImports: success,
    failedImports: failed,
    successRate: total > 0 ? success / total : null,
    retryCount: retries,
    avgDurationMs: durationCount > 0 ? durationSum / durationCount : null,
    timeoutCount: timeouts,
    cancellationCount: cancellations,
    failuresByCategory,
    engineName: engineName ?? null,
    engineVersion: engineVersion ?? null,
    engineHealthStatus: (engineHealthStatus as EngineHealthStatus | null) ?? null,
    lastSuccessfulImportAt: lastSuccessfulImportAt ?? null,
  };
}
