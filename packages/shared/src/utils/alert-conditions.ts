// Pure, reusable alert-condition predicates - the "foundation" the user
// asked for (thresholds + conditions), deliberately with NO scheduler and
// NO external integration (Slack/PagerDuty/etc.). apps/api's
// MonitoringController (GET /alerts) is the one place that evaluates these
// against live data and tracks how long each has been true; this file only
// knows how to answer "is this condition true right now, given this data
// and this threshold" - same "small, dependency-free utility" shape as
// apps/worker's subprocessLimiter.ts and logger.ts.
//
// Thresholds are plain numbers passed in, not hardcoded, since there is no
// production data yet to calibrate "backlogged" or "high failure rate"
// against - same posture as the Fusion Engine's own not-yet-calibrated
// weights (see CLAUDE.md).

export interface AlertThresholds {
  // A queue is "backlogged" once either count crosses its threshold.
  queueBacklogWaiting: number;
  queueBacklogActive: number;
  // Fraction (0-1) of failed/(completed+failed) that counts as "high".
  failureRate: number;
  // Fraction (0-1) of heapUsed/heapTotal that counts as memory pressure.
  heapUsageRatio: number;
  // Sprint 4C (Alert Engine) - fraction (0-1) of totalSizeBytes/quotaBytes
  // that counts as a storage warning. 0.8 matches the milestone's own
  // illustrative "used > 80%" example.
  storageQuotaRatio: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  queueBacklogWaiting: 100,
  queueBacklogActive: 50,
  failureRate: 0.2,
  heapUsageRatio: 0.9,
  storageQuotaRatio: 0.8,
};

export function isQueueBacklogged(
  counts: { waiting: number; active: number },
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): boolean {
  return (
    counts.waiting > thresholds.queueBacklogWaiting || counts.active > thresholds.queueBacklogActive
  );
}

export function isFailureRateHigh(
  failed: number,
  completed: number,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): boolean {
  const total = failed + completed;
  if (total === 0) return false;
  return failed / total > thresholds.failureRate;
}

export function hasLikelyStalledJobs(likelyStalled: number): boolean {
  return likelyStalled > 0;
}

export function isWorkerOffline(connectedWorkers: number): boolean {
  return connectedWorkers === 0;
}

// Shared by database/redis/storage reachability checks - all three report
// the same { reachable: boolean } shape (see monitoring.controller.ts).
export function isDependencyDown(reachable: boolean): boolean {
  return !reachable;
}

// Mirrors GET /backups' own `stale` flag (docs/backup-restore.md) - a
// backup is stale if its last run failed OR is older than
// BACKUP_STALE_AFTER_HOURS. Re-exposed as a named condition here rather
// than inventing a second staleness calculation, so there is exactly one
// definition of "stale" in the codebase.
export function isBackupStale(stale: boolean): boolean {
  return stale;
}

export function isHeapPressureHigh(
  heapUsedBytes: number,
  heapTotalBytes: number,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): boolean {
  if (heapTotalBytes === 0) return false;
  return heapUsedBytes / heapTotalBytes > thresholds.heapUsageRatio;
}

// Sprint 4C (Alert Engine) - quotaBytes is null when STORAGE_QUOTA_BYTES is
// unset; skip the check entirely rather than compare against an arbitrary
// number (no quota is configured anywhere in this codebase by default).
export function isStorageOverQuota(
  usedBytes: number,
  quotaBytes: number | null,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): boolean {
  if (quotaBytes === null || quotaBytes <= 0) return false;
  return usedBytes / quotaBytes > thresholds.storageQuotaRatio;
}

// Sprint 4C (Alert Engine) - "credit" here is a discrete unspent-or-spent
// PremiumCredit row, not a numeric wallet (see schema.prisma's own
// comment), so there is no meaningful "< N" threshold to pick - the one
// unambiguous trigger this schema supports is "ran out entirely."
export function isOutOfPurchasedCredit(unspentPaidCredits: number): boolean {
  return unspentPaidCredits === 0;
}
