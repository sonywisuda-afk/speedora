import {
  readDiarizationMetrics,
  readRecentDependencyMissingCount,
  RECENT_DEPENDENCY_MISSING_WINDOW_SECONDS,
  recordDiarizationOutcome,
  type DiarizationOutcomeEvent,
} from './diarization-metrics';
import type { RedisLike } from './video-import-metrics';

// Same minimal in-memory RedisLike stand-in as video-import-metrics.spec.ts
// (this module deliberately reuses that interface) - duplicated rather than
// imported/shared since each spec file should stay independently readable,
// same precedent as that file's own fake.
function createFakeRedis(): RedisLike & { expireMock: jest.Mock } {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, number>>();
  const expirations = new Map<string, number>();
  const expireMock = jest.fn(async (key: string, seconds: number) => {
    if (!strings.has(key)) return 0;
    expirations.set(key, seconds);
    return 1;
  });

  return {
    expireMock,
    expire: expireMock,
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

function successEvent(overrides: Partial<DiarizationOutcomeEvent> = {}): DiarizationOutcomeEvent {
  return { outcome: 'success', durationMs: 1000, speakerCount: 2, turnCount: 8, ...overrides };
}

function failureEvent(overrides: Partial<DiarizationOutcomeEvent> = {}): DiarizationOutcomeEvent {
  return { outcome: 'failure', category: 'missing_token', durationMs: 50, ...overrides };
}

describe('diarization-metrics', () => {
  it('reports an all-zero, null-fielded snapshot before any outcome is recorded', async () => {
    const redis = createFakeRedis();

    const snapshot = await readDiarizationMetrics(redis);

    expect(snapshot).toEqual({
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      successRate: null,
      avgDurationMs: null,
      failuresByCategory: {},
      lastSuccessfulRunAt: null,
      lastFailureCategory: null,
    });
  });

  it('increments totals/success and computes an average duration and success rate', async () => {
    const redis = createFakeRedis();

    await recordDiarizationOutcome(redis, successEvent({ durationMs: 1000 }));
    await recordDiarizationOutcome(redis, successEvent({ durationMs: 3000 }));

    const snapshot = await readDiarizationMetrics(redis);

    expect(snapshot.totalRuns).toBe(2);
    expect(snapshot.successfulRuns).toBe(2);
    expect(snapshot.failedRuns).toBe(0);
    expect(snapshot.successRate).toBe(1);
    expect(snapshot.avgDurationMs).toBe(2000);
    expect(snapshot.lastSuccessfulRunAt).not.toBeNull();
  });

  it('tracks failures and a per-category breakdown, and remembers the most recent category', async () => {
    const redis = createFakeRedis();

    await recordDiarizationOutcome(redis, successEvent());
    await recordDiarizationOutcome(redis, failureEvent({ category: 'missing_token' }));
    await recordDiarizationOutcome(redis, failureEvent({ category: 'dependency_missing' }));

    const snapshot = await readDiarizationMetrics(redis);

    expect(snapshot.totalRuns).toBe(3);
    expect(snapshot.successfulRuns).toBe(1);
    expect(snapshot.failedRuns).toBe(2);
    expect(snapshot.successRate).toBeCloseTo(1 / 3);
    expect(snapshot.failuresByCategory).toEqual({ missing_token: 1, dependency_missing: 1 });
    expect(snapshot.lastFailureCategory).toBe('dependency_missing');
  });

  it('only starts the recentDependencyMissing rolling window on "dependency_missing" failures', async () => {
    const redis = createFakeRedis();

    await recordDiarizationOutcome(redis, failureEvent({ category: 'network' }));
    expect(await readRecentDependencyMissingCount(redis)).toBe(0);

    await recordDiarizationOutcome(redis, failureEvent({ category: 'dependency_missing' }));
    expect(await readRecentDependencyMissingCount(redis)).toBe(1);

    await recordDiarizationOutcome(redis, failureEvent({ category: 'dependency_missing' }));
    expect(await readRecentDependencyMissingCount(redis)).toBe(2);

    expect(redis.expireMock).toHaveBeenCalledTimes(1);
    expect(redis.expireMock).toHaveBeenCalledWith(
      'speedora:diarization:dependencyMissing:recentWindow',
      RECENT_DEPENDENCY_MISSING_WINDOW_SECONDS,
    );
  });

  it('never counts a success toward the failuresByCategory/recentDependencyMissing signals', async () => {
    const redis = createFakeRedis();

    await recordDiarizationOutcome(redis, successEvent());

    const snapshot = await readDiarizationMetrics(redis);
    expect(snapshot.failuresByCategory).toEqual({});
    expect(await readRecentDependencyMissingCount(redis)).toBe(0);
  });
});
