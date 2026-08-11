import {
  findUsersByRoles,
  NotificationType,
  PremiumCreditStatus,
  runAlertRules,
  UserRole,
  type AlertRule,
} from '@speedora/database';
import {
  isOutOfPurchasedCredit,
  isStorageOverQuota,
  QueueName,
  readRecentDependencyMissingCount,
  readRecentInternalCrashCount,
  RECENT_DEPENDENCY_MISSING_WINDOW_SECONDS,
  RECENT_INTERNAL_CRASH_WINDOW_SECONDS,
} from '@speedora/shared';
import { getBucketUsage } from '@speedora/storage';
import { Worker } from 'bullmq';
import { forStage } from '../logger';
import { enqueueNotificationDelivery } from '../notificationDeliveryEnqueuer';
import { publishNotification } from '../notificationPublisher';
import { prisma } from '../prisma';
import { alertEngineQueue } from '../queues';
import { createRedisConnection } from '../redis';

const logger = forStage('alert-engine');

// How often every registered AlertRule is (re-)evaluated. Alerts here
// aren't time-critical to the minute (unlike schedule-publish-clip's 60s
// poll for due scheduled publishes) but shouldn't sit at 6h either (unlike
// sync-publish-stats, which is deliberately slow to conserve YouTube/Meta/
// TikTok API quota) - storageWarningRule's getBucketUsage() does a real
// paginated S3 listing (up to 20 pages, see packages/storage's MAX_PAGES)
// each tick, so 30 minutes balances "an ops user learns about a breach
// within half an hour" against "don't needlessly re-scan a large bucket
// every few minutes." Configurable without a redeploy since this cadence
// is genuinely more likely to need tuning per-environment than the other
// two triggers' fixed constants.
const ALERT_CHECK_INTERVAL_MS = Number(process.env.ALERT_CHECK_INTERVAL_MS) || 30 * 60 * 1000;

const ALERT_ENGINE_TRIGGER_JOB_ID = 'alert-engine-poll';

// Stabilization Pass Area 5 tech-debt fix - how many consecutive sync
// failures (sync-publish-stats.worker.ts/sync-follower-count.worker.ts) an
// account must reach before its owner is notified. Not calibrated against
// production data (there is none yet, same "no data to calibrate against"
// posture as docs/alerting.md's own thresholds) - 3 is a reasonable guess:
// low enough to catch a genuinely broken (e.g. revoked) token within a few
// sync intervals, high enough that a single transient API blip doesn't
// notify a user needlessly.
const SYNC_FAILURE_ALERT_THRESHOLD = Number(process.env.SYNC_FAILURE_ALERT_THRESHOLD) || 3;

// Same "AI Ops roles" set as apps/api/src/ops-ai/ops-ai.controller.ts's
// @Roles(...) - the one existing precedent for "which roles count as ops."
const OPS_ROLES = [UserRole.ADMIN, UserRole.AI_ENGINEER, UserRole.OPERATOR];

// Download Reliability Framework - how many 'internal'-category (crash)
// video-import failures within the rolling window (see
// RECENT_INTERNAL_CRASH_WINDOW_SECONDS in packages/shared's
// video-import-metrics.ts) count as a spike worth paging ops about. Not
// calibrated against production data (there is none yet) - same posture as
// SYNC_FAILURE_ALERT_THRESHOLD above.
const IMPORT_CRASH_ALERT_THRESHOLD = Number(process.env.IMPORT_CRASH_ALERT_THRESHOLD) || 5;

// Separate connection from the Worker's own BullMQ connection below - same
// "different concern, own connection" reasoning as import-youtube.worker.ts's
// metricsRedis.
const metricsRedis = createRedisConnection();

const storageWarningRule: AlertRule = {
  name: 'storage-warning',
  async evaluate(prismaClient) {
    const quotaBytes = process.env.STORAGE_QUOTA_BYTES
      ? Number(process.env.STORAGE_QUOTA_BYTES)
      : null;
    const usage = await getBucketUsage();
    const breached = isStorageOverQuota(usage.totalSizeBytes, quotaBytes);
    const recipientUserIds = breached
      ? (await findUsersByRoles(prismaClient, OPS_ROLES)).map((user) => user.id)
      : [];
    return [
      {
        dedupeKey: 'storage-warning',
        breached,
        recipientUserIds,
        notification: {
          type: NotificationType.STORAGE_WARNING,
          title: 'Peringatan kapasitas penyimpanan',
          body: `Penyimpanan objek terpakai ${(usage.totalSizeBytes / 1e9).toFixed(1)} GB dari kuota ${((quotaBytes ?? 0) / 1e9).toFixed(1)} GB.`,
          metadata: { usedBytes: usage.totalSizeBytes, quotaBytes, truncated: usage.truncated },
        },
      },
    ];
  },
};

const creditWarningRule: AlertRule = {
  name: 'credit-warning',
  async evaluate(prismaClient) {
    const paidCredits = await prismaClient.premiumCredit.findMany({
      where: { status: PremiumCreditStatus.PAID },
      select: { userId: true, videoId: true },
    });
    const unspentCountByUser = new Map<string, number>();
    for (const credit of paidCredits) {
      const current = unspentCountByUser.get(credit.userId) ?? 0;
      unspentCountByUser.set(credit.userId, current + (credit.videoId === null ? 1 : 0));
    }
    return [...unspentCountByUser.entries()].map(([userId, unspentCount]) => {
      const breached = isOutOfPurchasedCredit(unspentCount);
      return {
        dedupeKey: `credit-warning:${userId}`,
        breached,
        recipientUserIds: breached ? [userId] : [],
        notification: {
          type: NotificationType.CREDIT_WARNING,
          title: 'Kredit transkripsi premium habis',
          body: 'Kredit transkripsi premium Anda sudah habis. Beli kredit baru untuk melanjutkan transkripsi premium.',
        },
      };
    });
  },
};

// Stabilization Pass Area 5 tech-debt fix - a per-account rule, unlike
// storageWarningRule (system-wide) but the same "always return one instance
// per scanned entity, breached or not" shape as creditWarningRule, so a
// recovered account (consecutiveSyncFailures reset to 0 by a later sync
// success) re-arms its AlertState instead of staying permanently notified-
// once. Scans every SocialAccount each tick rather than pre-filtering to
// already-breached ones, same choice creditWarningRule already made, for the
// same reason: only re-arming lets a later re-breach notify again.
const syncFailureWarningRule: AlertRule = {
  name: 'sync-failure-warning',
  async evaluate(prismaClient) {
    const accounts = await prismaClient.socialAccount.findMany({
      select: {
        id: true,
        userId: true,
        platform: true,
        displayName: true,
        consecutiveSyncFailures: true,
      },
    });
    return accounts.map((account) => {
      const breached = account.consecutiveSyncFailures >= SYNC_FAILURE_ALERT_THRESHOLD;
      return {
        dedupeKey: `sync-failure-warning:${account.id}`,
        breached,
        recipientUserIds: breached ? [account.userId] : [],
        notification: {
          type: NotificationType.SYNC_FAILURE_WARNING,
          title: 'Sinkronisasi akun gagal berulang kali',
          body: `Sinkronisasi untuk akun ${account.platform} "${account.displayName}" telah gagal ${account.consecutiveSyncFailures}x berturut-turut. Sambungkan ulang akun ini di halaman Social Media.`,
          metadata: {
            socialAccountId: account.id,
            platform: account.platform,
            consecutiveSyncFailures: account.consecutiveSyncFailures,
          },
        },
      };
    });
  },
};

// Download Reliability Framework - system-wide (not per-account), same shape
// as storageWarningRule: one dedupeKey, breach re-arms once
// recentInternalCrashes drops back under threshold (the window naturally
// expires in Redis - see readRecentInternalCrashCount), no Prisma query
// needed to evaluate the condition itself (only to resolve recipients).
const videoImportInternalCrashSpikeRule: AlertRule = {
  name: 'video-import-crash-spike',
  async evaluate(prismaClient) {
    const recentCrashes = await readRecentInternalCrashCount(metricsRedis);
    const breached = recentCrashes >= IMPORT_CRASH_ALERT_THRESHOLD;
    const recipientUserIds = breached
      ? (await findUsersByRoles(prismaClient, OPS_ROLES)).map((user) => user.id)
      : [];
    return [
      {
        dedupeKey: 'video-import-crash-spike',
        breached,
        recipientUserIds,
        notification: {
          type: NotificationType.IMPORT_FAILURE_SPIKE,
          title: 'Lonjakan crash pada proses download video',
          body: `${recentCrashes} kegagalan download berkategori "internal crash" terjadi dalam ${Math.round(
            RECENT_INTERNAL_CRASH_WINDOW_SECONDS / 60,
          )} menit terakhir. Periksa kondisi worker (mis. antivirus, disk, proses zombie yt-dlp).`,
          metadata: { recentCrashes, threshold: IMPORT_CRASH_ALERT_THRESHOLD },
        },
      },
    ];
  },
};

// Speaker Intelligence Phase 0 (Production Diarization Foundation) - a
// fifth state-based rule, system-wide (same shape as
// videoImportInternalCrashSpikeRule right above). Deliberately NOT
// threshold-tuned like every other rule here (IMPORT_CRASH_ALERT_THRESHOLD,
// SYNC_FAILURE_ALERT_THRESHOLD): "dependency_missing" means the production
// worker image itself is missing torch/pyannote.audio (see packages/shared's
// diarization-metrics.ts and apps/worker/scripts/diarize_speakers.py's own
// header comment) - either the image build is broken (every diarization
// attempt in the window will report it) or it isn't (this category never
// occurs at all, this phase's whole point), so a threshold of 1 is the
// correct signal, not an arbitrary guess pending calibration.
const diarizationDependencyMissingRule: AlertRule = {
  name: 'diarization-dependency-missing',
  async evaluate(prismaClient) {
    const recentCount = await readRecentDependencyMissingCount(metricsRedis);
    const breached = recentCount >= 1;
    const recipientUserIds = breached
      ? (await findUsersByRoles(prismaClient, OPS_ROLES)).map((user) => user.id)
      : [];
    return [
      {
        dedupeKey: 'diarization-dependency-missing',
        breached,
        recipientUserIds,
        notification: {
          type: NotificationType.DIARIZATION_DEPENDENCY_MISSING,
          title: 'Speaker diarization tidak tersedia di production',
          body: `${recentCount} kegagalan diarization berkategori "dependency_missing" terjadi dalam ${Math.round(
            RECENT_DEPENDENCY_MISSING_WINDOW_SECONDS / 60,
          )} menit terakhir - image worker kemungkinan tidak memiliki torch/pyannote.audio terpasang. Periksa apps/worker/Dockerfile.`,
          metadata: { recentCount },
        },
      },
    ];
  },
};

// The registered list of active AlertRules - adding rule #6 (GPU almost
// full, AI worker offline, license/subscription expiry, dataset
// staleness) is exactly "write the rule object, add it to this array." No
// scheduler change, no new queue, no new plumbing - see runAlertRules in
// packages/database/src/alert-engine.ts.
const ALERT_RULES: AlertRule[] = [
  storageWarningRule,
  creditWarningRule,
  syncFailureWarningRule,
  videoImportInternalCrashSpikeRule,
  diarizationDependencyMissingRule,
];

// Idempotent, same pattern as sync-publish-stats.worker.ts's version of
// this - called once at startup (see main.ts).
export async function scheduleRepeatingTrigger(): Promise<void> {
  await alertEngineQueue.add(
    QueueName.ALERT_ENGINE,
    {},
    { repeat: { every: ALERT_CHECK_INTERVAL_MS }, jobId: ALERT_ENGINE_TRIGGER_JOB_ID },
  );
}

export function createAlertEngineWorker(): Worker {
  return new Worker(
    QueueName.ALERT_ENGINE,
    async () => {
      const { evaluated, notified } = await runAlertRules(prisma, ALERT_RULES, {
        publish: publishNotification,
        enqueueDelivery: enqueueNotificationDelivery,
      });
      if (notified > 0) {
        logger.info('alert engine tick', { evaluated, notified });
      }
    },
    { connection: createRedisConnection() },
  );
}
