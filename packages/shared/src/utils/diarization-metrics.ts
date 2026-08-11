// Speaker Intelligence Phase 0 (Production Diarization Foundation) -
// cross-process metrics store for speaker diarization outcomes, same
// "apps/worker and apps/api are separate Node processes, so in-memory
// counters don't work here" reasoning as video-import-metrics.ts, which
// this file deliberately mirrors field-for-field (KEYS shape,
// record/read split, RedisLike reuse). Exists because diarization used to
// fail SILENTLY: transcribe.worker.ts already caught every
// diarizeSpeakers() failure and fell back to "no speaker labels" (correct,
// unchanged by this phase - diarization must never fail the transcribe
// job), but nothing recorded THAT it happened, at what rate, or why - a
// broken production Docker image (this phase's own root cause) and a
// user who simply hasn't configured HUGGINGFACE_TOKEN yet were
// indistinguishable from the outside. This store is what makes that
// distinction visible without changing the fallback behavior itself.
//
// Reuses video-import-metrics.ts's RedisLike interface structurally
// (imported from there) rather than redeclaring it - same shape, no new
// interface needed.
import type { RedisLike } from './video-import-metrics';

// Mirrors @speedora/contracts's DiarizationFailureCategory locally rather
// than importing it - packages/shared deliberately avoids depending on
// packages/contracts (see types/video.ts's own comment on the same rule,
// and video-import-metrics.ts's identical mirroring of
// ImportFailureCategory).
export type DiarizationFailureCategory =
  | 'dependency_missing'
  | 'missing_token'
  | 'model_access_denied'
  | 'network'
  | 'timeout'
  | 'internal';

export interface DiarizationOutcomeEvent {
  outcome: 'success' | 'failure';
  category?: DiarizationFailureCategory;
  durationMs: number;
  // Only meaningful on success - how many distinct speakers/turns pyannote
  // found, useful for spotting a pipeline that "succeeds" but returns
  // suspiciously degenerate output (e.g. always exactly 1 speaker).
  speakerCount?: number;
  turnCount?: number;
}

export interface DiarizationMetricsSnapshot {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number | null;
  avgDurationMs: number | null;
  failuresByCategory: Partial<Record<DiarizationFailureCategory, number>>;
  lastSuccessfulRunAt: string | null;
  lastFailureCategory: DiarizationFailureCategory | null;
}

const KEYS = {
  total: 'speedora:diarization:total',
  success: 'speedora:diarization:success',
  failed: 'speedora:diarization:failed',
  durationSum: 'speedora:diarization:duration:sum',
  durationCount: 'speedora:diarization:duration:count',
  failuresByCategory: 'speedora:diarization:failuresByCategory',
  lastSuccessAt: 'speedora:diarization:lastSuccessAt',
  lastFailureCategory: 'speedora:diarization:lastFailureCategory',
  // A true fixed rolling window (EXPIRE set once, on creation, not reset on
  // every increment) - same reasoning and same shape as video-import-
  // metrics.ts's recentInternalCrashes: a genuine burst of
  // "dependency_missing" is what trips the alert, not one occurrence
  // sitting forever. Unlike that key, ANY occurrence within the window is
  // alert-worthy here (see alert-engine.worker.ts's
  // diarizationDependencyMissingRule) - dependency_missing means the
  // production image itself is missing torch/pyannote.audio, which either
  // is true (every run in the window will hit it) or isn't (this phase's
  // whole point), not a rate that needs a calibrated threshold.
  recentDependencyMissing: 'speedora:diarization:dependencyMissing:recentWindow',
} as const;

// Same window length as RECENT_INTERNAL_CRASH_WINDOW_SECONDS - not
// calibrated against production data (there is none yet), same posture as
// every other uncalibrated threshold in this codebase.
export const RECENT_DEPENDENCY_MISSING_WINDOW_SECONDS = 60 * 60;

export async function recordDiarizationOutcome(
  redis: RedisLike,
  event: DiarizationOutcomeEvent,
): Promise<void> {
  await redis.incr(KEYS.total);
  await redis.incrby(KEYS.durationSum, Math.round(event.durationMs));
  await redis.incr(KEYS.durationCount);

  if (event.outcome === 'success') {
    await redis.incr(KEYS.success);
    await redis.set(KEYS.lastSuccessAt, new Date().toISOString());
  } else {
    await redis.incr(KEYS.failed);
    if (event.category) {
      await redis.hincrby(KEYS.failuresByCategory, event.category, 1);
      await redis.set(KEYS.lastFailureCategory, event.category);
      if (event.category === 'dependency_missing') {
        const count = await redis.incr(KEYS.recentDependencyMissing);
        if (count === 1) {
          await redis.expire(
            KEYS.recentDependencyMissing,
            RECENT_DEPENDENCY_MISSING_WINDOW_SECONDS,
          );
        }
      }
    }
  }
}

// Read by diarizationDependencyMissingRule (apps/worker's alert-engine.worker.ts).
export async function readRecentDependencyMissingCount(redis: RedisLike): Promise<number> {
  return readInt(redis, KEYS.recentDependencyMissing);
}

async function readInt(redis: RedisLike, key: string): Promise<number> {
  const value = await redis.get(key);
  return value ? Number(value) : 0;
}

export async function readDiarizationMetrics(
  redis: RedisLike,
): Promise<DiarizationMetricsSnapshot> {
  const [
    total,
    success,
    failed,
    durationSum,
    durationCount,
    failuresByCategoryRaw,
    lastSuccessfulRunAt,
    lastFailureCategory,
  ] = await Promise.all([
    readInt(redis, KEYS.total),
    readInt(redis, KEYS.success),
    readInt(redis, KEYS.failed),
    readInt(redis, KEYS.durationSum),
    readInt(redis, KEYS.durationCount),
    redis.hgetall(KEYS.failuresByCategory),
    redis.get(KEYS.lastSuccessAt),
    redis.get(KEYS.lastFailureCategory),
  ]);

  const failuresByCategory: Partial<Record<DiarizationFailureCategory, number>> = {};
  for (const [category, count] of Object.entries(failuresByCategoryRaw)) {
    failuresByCategory[category as DiarizationFailureCategory] = Number(count);
  }

  return {
    totalRuns: total,
    successfulRuns: success,
    failedRuns: failed,
    successRate: total > 0 ? success / total : null,
    avgDurationMs: durationCount > 0 ? durationSum / durationCount : null,
    failuresByCategory,
    lastSuccessfulRunAt: lastSuccessfulRunAt ?? null,
    lastFailureCategory: (lastFailureCategory as DiarizationFailureCategory | null) ?? null,
  };
}
