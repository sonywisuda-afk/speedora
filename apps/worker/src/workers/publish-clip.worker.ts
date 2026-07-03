import * as Sentry from '@sentry/node';
import { PublishStatus, SocialPlatform } from '@viral-clip-app/database';
import {
  QueueName,
  type PublishClipJobData,
  type PublishClipJobResult,
} from '@viral-clip-app/shared';
import {
  resolveAccessToken,
  InstagramOAuthClient,
  TikTokOAuthClient,
  uploadInstagramReel,
  uploadTikTokVideo,
  uploadYouTubeVideo,
  YouTubeOAuthClient,
  type OAuthRefreshClient,
} from '@viral-clip-app/social';
import { getObjectStream, getPresignedDownloadUrl } from '@viral-clip-app/storage';
import { Worker, type Job } from 'bullmq';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';

// No constructor deps for any of the three clients (all read their
// credentials from process.env directly, same as apps/api's instances) -
// one shared instance of each is enough, same pattern as apps/api's
// SocialModule providing a single instance per platform.
const youtubeOAuth = new YouTubeOAuthClient();
const tiktokOAuth = new TikTokOAuthClient();
const instagramOAuth = new InstagramOAuthClient();

// How long the presigned URL handed to Meta's servers (Instagram Reels
// only - see CLAUDE.md's Fase 6d "Instagram" section) stays valid. Meta
// fetches the video shortly after the container-create call returns, so
// this just needs comfortable margin over that, not over the container's
// own (separately polled, up to 5 minutes) processing time.
const INSTAGRAM_PRESIGNED_URL_TTL_SECONDS = 15 * 60;

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

function buildDescription(hashtags: string[]): string {
  return hashtags.map((tag) => `#${tag}`).join(' ');
}

// Instagram Reels only has a single caption field (no separate title), so
// hookText and hashtags are combined here rather than split like YouTube's
// title/description.
function buildCaption(hookText: string | null, hashtags: string[]): string {
  const hashtagLine = buildDescription(hashtags);
  return [hookText, hashtagLine || null]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

export function createPublishClipWorker(): Worker<PublishClipJobData, PublishClipJobResult> {
  return new Worker<PublishClipJobData, PublishClipJobResult>(
    QueueName.PUBLISH_CLIP,
    async (job: Job<PublishClipJobData>) => {
      const { publishRecordId } = job.data;
      // The PublishRecord row (created synchronously by ClipsService.publish()
      // before enqueueing) is the single source of truth for everything this
      // job needs - re-fetched here rather than trusting the job payload, in
      // case clip/account state changed between enqueue and execution.
      const record = await prisma.publishRecord.findUniqueOrThrow({
        where: { id: publishRecordId },
        include: { clip: true, socialAccount: true },
      });

      console.log(`[publish-clip] publishing record ${publishRecordId} (clip ${record.clipId})`);

      try {
        await prisma.publishRecord.update({
          where: { id: publishRecordId },
          data: { status: PublishStatus.PUBLISHING },
        });

        if (!record.clip.outputUrl) {
          throw new Error(`Clip ${record.clipId} has no rendered output to publish`);
        }

        const platform = record.socialAccount.platform;
        const resolved = await resolveAccessToken(record.socialAccount, oauthClientFor(platform));
        if (resolved.refreshed && resolved.updated) {
          await prisma.socialAccount.update({
            where: { id: record.socialAccountId },
            data: resolved.updated,
          });
        }

        let platformPostId: string;
        let logDetail: string;
        if (platform === SocialPlatform.TIKTOK) {
          // Upload to Inbox (draft) - see CLAUDE.md's Fase 6d section for
          // why. publish_id just acknowledges TikTok received the video
          // into the user's inbox, it isn't a public content id/URL - the
          // user still has to open the TikTok app and finish posting
          // themselves. There's no title/caption field to set here either
          // (only Direct Post's API accepts one); hookText/hashtags are
          // simply unused for a TikTok publish.
          const videoStream = await getObjectStream(record.clip.outputUrl);
          const upload = await uploadTikTokVideo({
            accessToken: resolved.accessToken,
            videoStream,
          });
          platformPostId = upload.publishId;
          logDetail = `sent to TikTok inbox, publish_id ${upload.publishId}`;
        } else if (platform === SocialPlatform.INSTAGRAM) {
          // Instagram's Content Publishing API has no direct byte-upload
          // option - it fetches the video itself from a public HTTPS URL
          // (see CLAUDE.md's Fase 6d "Instagram" section), so a short-lived
          // presigned URL is generated instead of opening a stream here.
          const videoUrl = await getPresignedDownloadUrl(
            record.clip.outputUrl,
            INSTAGRAM_PRESIGNED_URL_TTL_SECONDS,
          );
          const upload = await uploadInstagramReel({
            accessToken: resolved.accessToken,
            igUserId: record.socialAccount.platformAccountId,
            videoUrl,
            caption: buildCaption(record.clip.hookText, record.clip.hashtags),
          });
          platformPostId = upload.mediaId;
          logDetail = `published as Instagram Reel, media id ${upload.mediaId}`;
        } else {
          const videoStream = await getObjectStream(record.clip.outputUrl);
          const upload = await uploadYouTubeVideo({
            accessToken: resolved.accessToken,
            title: record.clip.hookText || `Clip ${record.clip.id}`,
            description: buildDescription(record.clip.hashtags),
            videoStream,
            // Fase 6b default (see CLAUDE.md) - "publish now" uploads a
            // real video to the user's channel, and unlisted avoids a
            // mis-picked clip going live publicly with no safety net,
            // while still being an actual publish (unlike private, which
            // would defeat the point).
            privacyStatus: 'unlisted',
          });
          platformPostId = upload.videoId;
          logDetail = upload.url;
        }

        await prisma.publishRecord.update({
          where: { id: publishRecordId },
          data: {
            status: PublishStatus.PUBLISHED,
            platformPostId,
            publishedAt: new Date(),
          },
        });

        console.log(`[publish-clip] record ${publishRecordId} -> ${logDetail}`);
        return { publishRecordId, platformPostId };
      } catch (error) {
        console.error(`[publish-clip] record ${publishRecordId} failed:`, error);
        Sentry.captureException(error, {
          tags: {
            publishRecordId,
            clipId: record.clipId,
            socialAccountId: record.socialAccountId,
          },
        });

        // BullMQ's own attempts+backoff (configured where this job is
        // enqueued - see ClipsService.publish's PUBLISH_RETRY_OPTIONS)
        // handles transient failures automatically; only mark the record
        // FAILED once this was the last attempt, so the UI doesn't show a
        // final failure while a retry is still in flight. attemptsMade
        // reflects attempts completed *before* this one (BullMQ increments
        // it after the processor returns/throws), so attemptsMade + 1 is
        // this attempt's number.
        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (isFinalAttempt) {
          await prisma.publishRecord.update({
            where: { id: publishRecordId },
            data: {
              status: PublishStatus.FAILED,
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );
}
