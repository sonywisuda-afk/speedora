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

// The registered list of active AlertRules - adding rule #3 (GPU almost
// full, AI worker offline, license/subscription expiry, dataset
// staleness) is exactly "write the rule object, add it to this array." No
// scheduler change, no new queue, no new plumbing - see runAlertRules in
// packages/database/src/alert-engine.ts.
const ALERT_RULES: AlertRule[] = [storageWarningRule, creditWarningRule];

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
      });
      if (notified > 0) {
        logger.info('alert engine tick', { evaluated, notified });
      }
    },
    { connection: createRedisConnection() },
  );
}
