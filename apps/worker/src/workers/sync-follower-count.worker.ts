import * as Sentry from '@sentry/node';
import { QueueName } from '@speedora/shared';
import { resolveAccessToken } from '@speedora/social';
import { Worker } from 'bullmq';
import { forStage } from '../logger';
import { prisma } from '../prisma';
import { platformRegistry, platformsWithFollowerSync } from '../publish/platform-registry';
import { syncFollowerCountQueue } from '../queues';
import { createRedisConnection } from '../redis';

const logger = forStage('sync-follower-count');

// Daily, not every 6h like sync-publish-stats.worker.ts - follower counts
// don't need that freshness, and this is one API call per connected
// account regardless of how many clips that account has published, so
// there's no reason to run it as often.
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

const SYNC_TRIGGER_JOB_ID = 'sync-follower-count-poll';

// Same idempotent "register once at startup" pattern as
// sync-publish-stats.worker.ts's own scheduleRepeatingTrigger.
export async function scheduleRepeatingTrigger(): Promise<void> {
  await syncFollowerCountQueue.add(
    QueueName.SYNC_FOLLOWER_COUNT,
    {},
    { repeat: { every: SYNC_INTERVAL_MS }, jobId: SYNC_TRIGGER_JOB_ID },
  );
}

export function createSyncFollowerCountWorker(): Worker {
  return new Worker(
    QueueName.SYNC_FOLLOWER_COUNT,
    async () => {
      // Every connected account on a platform with a fetchFollowerCount
      // adapter - not scoped to PublishRecord at all (unlike
      // sync-publish-stats.worker.ts), since a follower count is a
      // property of the account itself, not any particular publish.
      const accounts = await prisma.socialAccount.findMany({
        where: { platform: { in: platformsWithFollowerSync() } },
      });

      let synced = 0;
      for (const account of accounts) {
        // One account failing (token revoked, not yet reconnected to grant
        // a newly-added scope like TikTok's user.info.stats, transient API
        // error) shouldn't stop the rest of the batch - isolated per
        // account, same posture as sync-publish-stats.worker.ts's
        // per-record isolation. No snapshot row is created for a failed
        // account this run - absence of recent rows is itself the "not
        // available" signal (see platform-capability.util.ts).
        try {
          const adapter = platformRegistry[account.platform];
          if (!adapter.fetchFollowerCount) continue;

          const resolved = await resolveAccessToken(account, adapter.oauth);
          if (resolved.refreshed && resolved.updated) {
            await prisma.socialAccount.update({
              where: { id: account.id },
              data: resolved.updated,
            });
          }

          const followerCount = await adapter.fetchFollowerCount({
            accessToken: resolved.accessToken,
            platformAccountId: account.platformAccountId,
          });

          await prisma.socialAccountFollowerSnapshot.create({
            data: { socialAccountId: account.id, followerCount },
          });
          synced += 1;
        } catch (error) {
          logger.error(
            'account failed',
            { socialAccountId: account.id, platform: account.platform },
            error,
          );
          Sentry.captureException(error, { tags: { socialAccountId: account.id } });
        }
      }

      if (synced > 0) {
        logger.info('synced follower counts', { synced });
      }
    },
    { connection: createRedisConnection() },
  );
}
