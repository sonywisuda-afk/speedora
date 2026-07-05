import * as Sentry from '@sentry/node';
import { PublishStatus, SocialPlatform } from '@speedora/database';
import { QueueName } from '@speedora/shared';
import {
  fetchInstagramMediaStats,
  fetchTikTokPublishStatus,
  fetchTikTokVideoStats,
  fetchYouTubeVideoStats,
  InstagramOAuthClient,
  resolveAccessToken,
  TikTokOAuthClient,
  YouTubeOAuthClient,
  type OAuthRefreshClient,
} from '@speedora/social';
import { Worker } from 'bullmq';
import { prisma } from '../prisma';
import { syncPublishStatsQueue } from '../queues';
import { createRedisConnection } from '../redis';

// How often view/like/comment counts are refreshed - a balance between
// freshness and API cost (YouTube Data API quota units, Meta/TikTok rate
// limits), not something that needs to be near-real-time for "basic"
// analytics.
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const SYNC_TRIGGER_JOB_ID = 'sync-publish-stats-poll';

// No constructor deps (all three read their credentials from process.env
// directly, same as publish-clip.worker.ts's instances).
const youtubeOAuth = new YouTubeOAuthClient();
const tiktokOAuth = new TikTokOAuthClient();
const instagramOAuth = new InstagramOAuthClient();

function oauthClientFor(platform: SocialPlatform): OAuthRefreshClient {
  switch (platform) {
    case SocialPlatform.YOUTUBE:
      return youtubeOAuth;
    case SocialPlatform.TIKTOK:
      return tiktokOAuth;
    case SocialPlatform.INSTAGRAM:
      return instagramOAuth;
  }
}

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
          socialAccount: {
            platform: {
              in: [SocialPlatform.YOUTUBE, SocialPlatform.INSTAGRAM, SocialPlatform.TIKTOK],
            },
          },
        },
        include: { socialAccount: true },
      });

      let synced = 0;
      let pending = 0;
      for (const record of records) {
        // One clip's stats failing (token revoked, video deleted on the
        // platform, transient API error) shouldn't stop the rest of the
        // batch from syncing - isolated per record, not per-batch.
        try {
          if (!record.platformPostId) continue;

          const resolved = await resolveAccessToken(
            record.socialAccount,
            oauthClientFor(record.socialAccount.platform),
          );
          if (resolved.refreshed && resolved.updated) {
            await prisma.socialAccount.update({
              where: { id: record.socialAccountId },
              data: resolved.updated,
            });
          }

          let stats: {
            viewCount: number | null;
            likeCount: number | null;
            commentCount: number | null;
          };
          if (record.socialAccount.platform === SocialPlatform.YOUTUBE) {
            stats = await fetchYouTubeVideoStats(resolved.accessToken, record.platformPostId);
          } else if (record.socialAccount.platform === SocialPlatform.INSTAGRAM) {
            stats = await fetchInstagramMediaStats(resolved.accessToken, record.platformPostId);
          } else {
            // TikTok - platformPostId here is the ephemeral publish_id from
            // Upload to Inbox (Fase 6d), not a video id. A real, queryable
            // video id only exists once the user actually finishes posting
            // the draft themselves from their TikTok inbox - until then
            // this is a normal "not yet" state, not a failure, so it's
            // skipped without going through the catch block below. See
            // CLAUDE.md's Fase 6e section.
            const publishStatus = await fetchTikTokPublishStatus(
              resolved.accessToken,
              record.platformPostId,
            );
            if (!publishStatus.videoId) {
              pending += 1;
              continue;
            }
            stats = await fetchTikTokVideoStats(resolved.accessToken, publishStatus.videoId);
          }

          await prisma.publishRecord.update({
            where: { id: record.id },
            data: {
              viewCount: stats.viewCount,
              likeCount: stats.likeCount,
              commentCount: stats.commentCount,
              statsUpdatedAt: new Date(),
            },
          });
          synced += 1;
        } catch (error) {
          console.error(`[sync-publish-stats] record ${record.id} failed:`, error);
          Sentry.captureException(error, {
            tags: { publishRecordId: record.id, socialAccountId: record.socialAccountId },
          });
        }
      }

      if (synced > 0 || pending > 0) {
        console.log(
          `[sync-publish-stats] synced ${synced} record(s), ${pending} TikTok record(s) still pending user finishing their post`,
        );
      }
    },
    { connection: createRedisConnection() },
  );
}
