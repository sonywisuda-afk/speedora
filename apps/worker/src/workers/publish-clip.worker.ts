import * as Sentry from '@sentry/node';
import { PublishStatus } from '@viral-clip-app/database';
import {
  QueueName,
  type PublishClipJobData,
  type PublishClipJobResult,
} from '@viral-clip-app/shared';
import { resolveAccessToken, uploadYouTubeVideo, YouTubeOAuthClient } from '@viral-clip-app/social';
import { getObjectStream } from '@viral-clip-app/storage';
import { Worker, type Job } from 'bullmq';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';

// No constructor deps (reads GOOGLE_OAUTH_CLIENT_ID/SECRET from process.env
// directly, same as apps/api's instance) - one shared instance is enough,
// same pattern as apps/api's SocialModule providing a single YouTubeOAuthClient.
const youtubeOAuth = new YouTubeOAuthClient();

function buildDescription(hashtags: string[]): string {
  return hashtags.map((tag) => `#${tag}`).join(' ');
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

        const resolved = await resolveAccessToken(record.socialAccount, youtubeOAuth);
        if (resolved.refreshed && resolved.updated) {
          await prisma.socialAccount.update({
            where: { id: record.socialAccountId },
            data: resolved.updated,
          });
        }

        const videoStream = await getObjectStream(record.clip.outputUrl);
        const upload = await uploadYouTubeVideo({
          accessToken: resolved.accessToken,
          title: record.clip.hookText || `Clip ${record.clip.id}`,
          description: buildDescription(record.clip.hashtags),
          videoStream,
          // Fase 6b default (see CLAUDE.md) - "publish now" uploads a real
          // video to the user's channel, and unlisted avoids a mis-picked
          // clip going live publicly with no safety net, while still being
          // an actual publish (unlike private, which would defeat the point).
          privacyStatus: 'unlisted',
        });

        await prisma.publishRecord.update({
          where: { id: publishRecordId },
          data: {
            status: PublishStatus.PUBLISHED,
            platformPostId: upload.videoId,
            publishedAt: new Date(),
          },
        });

        console.log(`[publish-clip] record ${publishRecordId} -> ${upload.url}`);
        return { publishRecordId, platformPostId: upload.videoId };
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
