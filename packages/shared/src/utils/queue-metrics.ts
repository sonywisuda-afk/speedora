// Oracle Cloud Free hybrid deployment (Fase 3 - Queue Metrics) - pure
// computation over BullMQ job data, kept separate from apps/api's
// MonitoringController the same way alert-conditions.ts's predicates are:
// the controller fetches raw data (queue.getJobCounts()/getJobs()), these
// functions turn it into numbers, so the numbers are unit-testable without
// a real Queue/Redis. No new Redis keys or worker-side instrumentation -
// avgProcessingTimeMs/retriedJobs are computed from a bounded sample of
// each queue's own recently completed/failed jobs (BullMQ already retains
// these per queues.ts's defaultJobOptions), the same
// "sample recent jobs, bound the cost" shape
// apps/api's countLikelyStalled() already uses for its own likelyStalled
// figure.

// Structural, not BullMQ's own Job<T> type - only the three fields these
// functions actually read, so they stay testable with plain object
// literals instead of constructing real BullMQ Job instances. Optional
// (matching BullMQ's own Job.processedOn?/finishedOn?), not `| null` - a
// job that hasn't reached that stage simply omits the field.
export interface JobSample {
  processedOn?: number;
  finishedOn?: number;
  attemptsMade: number;
}

// null (rather than 0) when there's no completed/failed data yet in the
// sample - "unknown" is a meaningfully different answer from "zero failure
// rate"/"instant processing", same reasoning as video-import-metrics.ts's
// avgDurationMs/successRate being nullable.
export function computeFailureRate(failed: number, completed: number): number | null {
  const total = failed + completed;
  return total > 0 ? failed / total : null;
}

export function computeAvgProcessingTimeMs(completedSample: JobSample[]): number | null {
  const durations = completedSample
    .map((job) =>
      typeof job.processedOn === 'number' && typeof job.finishedOn === 'number'
        ? job.finishedOn - job.processedOn
        : null,
    )
    .filter((value): value is number => value !== null);

  if (durations.length === 0) return null;
  return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

// A "retry" here means the job needed more than one attempt before landing
// in completed or failed - attemptsMade is BullMQ's own 1-indexed counter
// (1 means it succeeded/failed on the first try, no retry happened).
export function countRetriedJobs(sample: JobSample[]): number {
  return sample.filter((job) => job.attemptsMade > 1).length;
}
