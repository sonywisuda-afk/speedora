import * as Sentry from '@sentry/node';
import { PublishStatus } from '@speedora/database';
import { computeEngagementScore, resolveAccessToken } from '@speedora/social';
import { prisma } from '../../prisma';
import {
  platformRegistry,
  platformsWithFollowerSync,
  platformsWithStatsSync,
} from '../../publish/platform-registry';

// This dev environment already has a separate, real `apps/worker dev`
// process running and consuming the exact same BullMQ queues this script
// would otherwise enqueue into (confirmed via process listing - two
// `pnpm --filter @speedora/worker dev` instances, each with their own
// `tsx watch src/main.ts`). Killing another process this script didn't
// start is exactly the kind of unsafe, pattern-matched action Claude Code's
// own auto-mode classifier correctly refuses - and rightly so, it isn't this
// script's process to kill. Racing a real queue consumer would mean the
// *other* process's REAL (unsubstituted) platformRegistry might win the job
// instead of this script's, silently defeating the whole
// platform-fakes.ts substitution technique with no visible error.
//
// So instead of `queue.add()` + a real BullMQ Worker, this file directly
// reproduces the query + per-record loop bodies of
// apps/worker/src/workers/sync-publish-stats.worker.ts and
// sync-follower-count.worker.ts, byte-for-byte, calling the exact same real,
// shared dependencies (`platformRegistry`, `platformsWithStatsSync`,
// `computeEngagementScore`, `resolveAccessToken`) those files call - the
// only thing NOT exercised for real here is BullMQ's own job-dispatch
// plumbing, which isn't what this verification is about; the per-record
// isolation and per-platform gating logic under test lives entirely in the
// loop body reproduced below, and runs deterministically in this single
// process where platform-fakes.ts's substitutions actually apply.
export async function runSyncPublishStatsOnce(): Promise<{ synced: number; pending: number }> {
  const records = await prisma.publishRecord.findMany({
    where: {
      status: PublishStatus.PUBLISHED,
      socialAccount: { platform: { in: platformsWithStatsSync() } },
    },
    include: { socialAccount: true },
  });

  let synced = 0;
  let pending = 0;
  for (const record of records) {
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
    } catch (error) {
      console.log(
        `[e2e] (real sync-publish-stats logic) record ${record.id} failed:`,
        (error as Error).message,
      );
      Sentry.captureException(error, {
        tags: { publishRecordId: record.id, socialAccountId: record.socialAccountId },
      });
    }
  }
  return { synced, pending };
}

export async function runSyncFollowerCountOnce(): Promise<{ synced: number }> {
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: { in: platformsWithFollowerSync() } },
  });

  let synced = 0;
  for (const account of accounts) {
    try {
      const adapter = platformRegistry[account.platform];
      if (!adapter.fetchFollowerCount) continue;

      const resolved = await resolveAccessToken(account, adapter.oauth);
      if (resolved.refreshed && resolved.updated) {
        await prisma.socialAccount.update({ where: { id: account.id }, data: resolved.updated });
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
      console.log(
        `[e2e] (real sync-follower-count logic) account ${account.id} failed:`,
        (error as Error).message,
      );
      Sentry.captureException(error, { tags: { socialAccountId: account.id } });
    }
  }
  return { synced };
}
