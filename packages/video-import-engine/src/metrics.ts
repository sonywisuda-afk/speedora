import type { ImportFailureCategory } from '@speedora/contracts';
import type { VideoImportError } from './errors';

// Pure translation only - no Redis/IO here (this package stays storage-free).
// The adapter passes this event to @speedora/shared's
// recordVideoImportOutcome, which owns the actual cross-process store.
export interface VideoImportMetricEvent {
  outcome: 'success' | 'failure';
  category?: ImportFailureCategory;
  durationMs: number;
  retries: number;
  timedOut: boolean;
  cancelled: boolean;
}

export function toSuccessMetricEvent(result: {
  durationMs: number;
  retries: number;
}): VideoImportMetricEvent {
  return {
    outcome: 'success',
    durationMs: result.durationMs,
    retries: result.retries,
    timedOut: false,
    cancelled: false,
  };
}

export function toFailureMetricEvent(
  error: VideoImportError,
  durationMs: number,
): VideoImportMetricEvent {
  return {
    outcome: 'failure',
    category: error.category,
    durationMs,
    retries: error.retries ?? 0,
    timedOut: error.category === 'timeout',
    cancelled: error.category === 'cancelled',
  };
}
