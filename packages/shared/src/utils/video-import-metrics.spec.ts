import {
  recordVideoImportOutcome,
  readVideoImportMetrics,
  type RedisLike,
  type VideoImportOutcomeEvent,
} from './video-import-metrics';

// A minimal in-memory stand-in for ioredis/BullMQ's queue.client - exercises
// the exact same INCR/INCRBY/HINCRBY/GET/SET/HGETALL surface RedisLike
// declares, without a real Redis server.
function createFakeRedis(): RedisLike {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, number>>();

  return {
    async incr(key) {
      const next = (Number(strings.get(key)) || 0) + 1;
      strings.set(key, String(next));
      return next;
    },
    async incrby(key, amount) {
      const next = (Number(strings.get(key)) || 0) + amount;
      strings.set(key, String(next));
      return next;
    },
    async hincrby(key, field, amount) {
      const hash = hashes.get(key) ?? new Map<string, number>();
      const next = (hash.get(field) ?? 0) + amount;
      hash.set(field, next);
      hashes.set(key, hash);
      return next;
    },
    async get(key) {
      return strings.get(key) ?? null;
    },
    async set(key, value) {
      strings.set(key, value);
      return 'OK';
    },
    async hgetall(key) {
      const hash = hashes.get(key);
      if (!hash) return {};
      return Object.fromEntries(
        [...hash.entries()].map(([field, count]) => [field, String(count)]),
      );
    },
  };
}

function successEvent(overrides: Partial<VideoImportOutcomeEvent> = {}): VideoImportOutcomeEvent {
  return {
    outcome: 'success',
    durationMs: 1000,
    retries: 0,
    timedOut: false,
    cancelled: false,
    engineName: 'yt-dlp',
    engineVersion: '2025.06.30',
    engineHealthStatus: 'healthy',
    ...overrides,
  };
}

function failureEvent(overrides: Partial<VideoImportOutcomeEvent> = {}): VideoImportOutcomeEvent {
  return {
    outcome: 'failure',
    category: 'network',
    durationMs: 500,
    retries: 1,
    timedOut: false,
    cancelled: false,
    engineName: 'yt-dlp',
    engineVersion: '2025.06.30',
    engineHealthStatus: 'healthy',
    ...overrides,
  };
}

describe('video-import-metrics', () => {
  it('reports an all-zero, null-fielded snapshot before any outcome is recorded', async () => {
    const redis = createFakeRedis();

    const snapshot = await readVideoImportMetrics(redis);

    expect(snapshot).toEqual({
      totalImports: 0,
      successfulImports: 0,
      failedImports: 0,
      successRate: null,
      retryCount: 0,
      avgDurationMs: null,
      timeoutCount: 0,
      cancellationCount: 0,
      failuresByCategory: {},
      engineName: null,
      engineVersion: null,
      engineHealthStatus: null,
      lastSuccessfulImportAt: null,
    });
  });

  it('increments totals/success and computes an average duration and success rate', async () => {
    const redis = createFakeRedis();

    await recordVideoImportOutcome(redis, successEvent({ durationMs: 1000 }));
    await recordVideoImportOutcome(redis, successEvent({ durationMs: 3000 }));

    const snapshot = await readVideoImportMetrics(redis);

    expect(snapshot.totalImports).toBe(2);
    expect(snapshot.successfulImports).toBe(2);
    expect(snapshot.failedImports).toBe(0);
    expect(snapshot.successRate).toBe(1);
    expect(snapshot.avgDurationMs).toBe(2000);
    expect(snapshot.lastSuccessfulImportAt).not.toBeNull();
  });

  it('tracks failures, retries, timeouts, cancellations and a per-category breakdown', async () => {
    const redis = createFakeRedis();

    await recordVideoImportOutcome(redis, successEvent());
    await recordVideoImportOutcome(redis, failureEvent({ category: 'network', retries: 2 }));
    await recordVideoImportOutcome(
      redis,
      failureEvent({ category: 'timeout', timedOut: true, retries: 0 }),
    );
    await recordVideoImportOutcome(
      redis,
      failureEvent({ category: 'cancelled', cancelled: true, retries: 0 }),
    );

    const snapshot = await readVideoImportMetrics(redis);

    expect(snapshot.totalImports).toBe(4);
    expect(snapshot.successfulImports).toBe(1);
    expect(snapshot.failedImports).toBe(3);
    expect(snapshot.successRate).toBe(0.25);
    expect(snapshot.retryCount).toBe(2);
    expect(snapshot.timeoutCount).toBe(1);
    expect(snapshot.cancellationCount).toBe(1);
    expect(snapshot.failuresByCategory).toEqual({ network: 1, timeout: 1, cancelled: 1 });
  });

  it('records the latest engine name/version/health status', async () => {
    const redis = createFakeRedis();

    await recordVideoImportOutcome(
      redis,
      successEvent({ engineVersion: '2025.01.01', engineHealthStatus: 'stale' }),
    );
    await recordVideoImportOutcome(
      redis,
      successEvent({ engineVersion: '2025.06.30', engineHealthStatus: 'healthy' }),
    );

    const snapshot = await readVideoImportMetrics(redis);

    expect(snapshot.engineName).toBe('yt-dlp');
    expect(snapshot.engineVersion).toBe('2025.06.30');
    expect(snapshot.engineHealthStatus).toBe('healthy');
  });
});
