import {
  findUsersByRoles,
  NotificationType,
  PremiumCreditStatus,
  runAlertRules,
  UserRole,
  type AlertRule,
} from '@speedora/database';
import { isOutOfPurchasedCredit, isStorageOverQuota, QueueName } from '@speedora/shared';
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

// The registered list of active AlertRules - adding rule #4 (GPU almost
// full, AI worker offline, license/subscription expiry, dataset
// staleness) is exactly "write the rule object, add it to this array." No
// scheduler change, no new queue, no new plumbing - see runAlertRules in
// packages/database/src/alert-engine.ts.
const ALERT_RULES: AlertRule[] = [storageWarningRule, creditWarningRule, syncFailureWarningRule];

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
