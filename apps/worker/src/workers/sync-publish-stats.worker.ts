import * as Sentry from '@sentry/node';
import { PublishStatus } from '@speedora/database';
import { QueueName } from '@speedora/shared';
import { computeEngagementScore, resolveAccessToken } from '@speedora/social';
import { Worker } from 'bullmq';
import { forStage } from '../logger';
import { prisma } from '../prisma';
import { platformRegistry, platformsWithStatsSync } from '../publish/platform-registry';
import { syncPublishStatsQueue } from '../queues';
import { createRedisConnection } from '../redis';

const logger = forStage('sync-publish-stats');

// How often view/like/comment counts are refreshed - a balance between
// freshness and API cost (YouTube Data API quota units, Meta/TikTok rate
// limits), not something that needs to be near-real-time for "basic"
// analytics.
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const SYNC_TRIGGER_JOB_ID = 'sync-publish-stats-poll';

// Registers the single repeatable trigger that fires this worker's
// processor every SYNC_INTERVAL_MS - called once at startup (see main.ts).
// Idempotent, same as schedule-publish-clip.worker.ts's version of this.
export async function scheduleRepeatingTrigger(): Promise<void> {
  await syncPublishStatsQueue.add(
    QueueName.SYNC_PUBLISH_STATS,
    {},
    { repeat: { every: SYNC_INTERVAL_MS }, jobId: SYNC_TRIGGER_JOB_ID },
  );
}

export function createSyncPublishStatsWorker(): Worker {
  return new Worker(
    QueueName.SYNC_PUBLISH_STATS,
    async () => {
      const records = await prisma.publishRecord.findMany({
        where: {
          status: PublishStatus.PUBLISHED,
          socialAccount: { platform: { in: platformsWithStatsSync() } },
        },
        include: { socialAccount: true },
      });

      let synced = 0;
      let pending = 0;
      // Stabilization Pass Area 5 tech-debt fix: tracks each account's
      // outcome for this tick, not each record's - one broken account can
      // own several PublishRecords, and a single stale/deleted post
      // shouldn't read as "the account is broken" alongside others from the
      // same account still syncing fine. Any success for the account this
      // tick wins over an earlier failure (resolveAccessToken/adapter calls
      // are per-record, so a transient blip on record 1 followed by a real
      // success on record 2 means the account itself is fine).
      const accountOutcomes = new Map<string, 'success' | 'failure'>();
      for (const record of records) {
        // One clip's stats failing (token revoked, video deleted on the
        // platform, transient API error) shouldn't stop the rest of the
        // batch from syncing - isolated per record, not per-batch. A
        // BullMQ-level retry wouldn't help here anyway - the next scheduled
        // tick already re-attempts every record - so this still never
        // rethrows. What used to be silent forever is now escalated via
        // accountOutcomes below: a permanently broken account crosses
        // alert-engine.worker.ts's sync-failure-warning threshold and
        // notifies its owner instead of failing invisibly. Same shape of
        // fix applied to sync-follower-count.worker.ts's per-account loop.
        try {
          if (!record.platformPostId) continue;

          const adapter = platformRegistry[record.socialAccount.platform];
          if (!adapter.syncStats) continue;

          const resolved = await resolveAccessToken(record.socialAccount, adapter.oauth);
          if (resolved.refreshed && resolved.updated) {
            await prisma.socialAccount.update({
              where: { id: record.socialAccountId },
              data: resolved.updated,
            });
          }

          const result = await adapter.syncStats({
            accessToken: resolved.accessToken,
            platformPostId: record.platformPostId,
          });
          if (result.kind === 'pending') {
            pending += 1;
            continue;
          }
          const { stats } = result;

          await prisma.publishRecord.update({
            where: { id: record.id },
            data: {
              viewCount: stats.viewCount,
              likeCount: stats.likeCount,
              commentCount: stats.commentCount,
              statsUpdatedAt: new Date(),
            },
          });
          // Milestone 1 (Dataset & Feedback Loop): append-only history, on
          // top of the "latest snapshot" update above - see
          // PublishRecordStatsSnapshot's doc comment in schema.prisma.
          await prisma.publishRecordStatsSnapshot.create({
            data: {
              publishRecordId: record.id,
              viewCount: stats.viewCount,
              likeCount: stats.likeCount,
              commentCount: stats.commentCount,
              shareCount: stats.shareCount ?? null,
              watchTimeSeconds: stats.watchTimeSeconds ?? null,
              engagementScore: computeEngagementScore({
                viewCount: stats.viewCount,
                likeCount: stats.likeCount,
                commentCount: stats.commentCount,
                shareCount: stats.shareCount ?? null,
              }),
            },
          });
          synced += 1;
          accountOutcomes.set(record.socialAccountId, 'success');
        } catch (error) {
          logger.error(
            'record failed',
            { publishRecordId: record.id, socialAccountId: record.socialAccountId },
            error,
          );
          Sentry.captureException(error, {
            tags: { publishRecordId: record.id, socialAccountId: record.socialAccountId },
          });
          if (accountOutcomes.get(record.socialAccountId) !== 'success') {
            accountOutcomes.set(record.socialAccountId, 'failure');
          }
        }
      }

      for (const [socialAccountId, outcome] of accountOutcomes) {
        if (outcome === 'success') {
          await prisma.socialAccount.updateMany({
            where: { id: socialAccountId, consecutiveSyncFailures: { gt: 0 } },
            data: { consecutiveSyncFailures: 0 },
          });
        } else {
          await prisma.socialAccount.update({
            where: { id: socialAccountId },
            data: { consecutiveSyncFailures: { increment: 1 }, lastSyncFailureAt: new Date() },
          });
        }
      }

      if (synced > 0 || pending > 0) {
        logger.info('synced publish stats', { synced, pending });
      }
    },
    { connection: createRedisConnection() },
  );
}
