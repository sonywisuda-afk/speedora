import * as Sentry from '@sentry/node';
import { ClipPlatformCopyStatus } from '@speedora/database';
import { generatePlatformCopy } from '@speedora/seo-copy';
import { QueueName, type GeneratePlatformCopyJobData } from '@speedora/shared';
import { Worker, type Job } from 'bullmq';
import { forStage } from '../logger';
import { openai } from '../openai';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';

const logger = forStage('generate-platform-copy');

// Adapter (see root ARCHITECTURE.md's DB-vs-JSON-contract pattern): this
// file is the only place that touches Prisma/BullMQ/Sentry for this step.
// All of the actual LLM call/sanitization lives in the stateless
// @speedora/seo-copy module, tested purely with JSON fixtures. A brand-new,
// standalone LLM call - never reads/writes Clip.scores/viralityScore/
// highlightScore or the frozen detect-clips prompt (Publishing Expansion
// Phase 7B).
//
// No withJobTimeout here - matches export-generate.worker.ts/
// publish-clip.worker.ts (the two workers with the closest real shape: a
// single external call, no self-chaining, apps/api-sole-producer), neither
// of which uses an outer job timeout. Relies on the OpenAI SDK's own
// ~10min default request timeout, same underlying mechanism detect-clips
// leans on for its own single LLM call.
export function createGeneratePlatformCopyWorker(): Worker<GeneratePlatformCopyJobData> {
  return new Worker<GeneratePlatformCopyJobData>(
    QueueName.GENERATE_PLATFORM_COPY,
    async (job: Job<GeneratePlatformCopyJobData>) => {
      const { clipPlatformCopyId } = job.data;

      // Atomic claim, same pattern and reasoning as publish-clip.worker.ts's
      // QUEUED -> PUBLISHING updateMany: rules out a concurrent second
      // execution of this same job (BullMQ stalled-job recovery, or two
      // overlapping attempts). ClipPlatformCopy rows are append-only - each
      // Generate/Regenerate click creates its own row - so there's never
      // contention over one row between two DIFFERENT generations, only
      // this narrower "same job redelivered" case.
      const claim = await prisma.clipPlatformCopy.updateMany({
        where: { id: clipPlatformCopyId, status: ClipPlatformCopyStatus.PENDING },
        data: { status: ClipPlatformCopyStatus.PROCESSING },
      });
      if (claim.count !== 1) {
        logger.info(
          'row is not PENDING (already claimed or finished by another execution) - skipping',
          { clipPlatformCopyId },
        );
        return;
      }

      // The ClipPlatformCopy row (created synchronously by
      // ClipsService.generatePlatformCopy() before enqueueing) is the
      // single source of truth for what to generate - re-fetched here
      // rather than trusting the job payload, same convention as
      // publish-clip.worker.ts's PublishRecord re-fetch.
      const row = await prisma.clipPlatformCopy.findUniqueOrThrow({
        where: { id: clipPlatformCopyId },
        include: { clip: true },
      });

      logger.info('generating platform copy', {
        clipPlatformCopyId,
        clipId: row.clipId,
        platform: row.platform,
      });

      try {
        const result = await generatePlatformCopy(
          {
            platform: row.platform,
            hookText: row.clip.hookText ?? '',
            topics: row.clip.topics,
            keywords: row.clip.keywords,
            ctaText: row.clip.ctaText ?? '',
            reason: row.clip.reason ?? '',
          },
          { openai },
        );

        await prisma.clipPlatformCopy.update({
          where: { id: clipPlatformCopyId },
          data: {
            status: ClipPlatformCopyStatus.READY,
            caption: result.caption,
            hashtags: result.hashtags,
            description: result.description,
            failReason: null,
          },
        });

        logger.info('platform copy generated', { clipPlatformCopyId });
      } catch (error) {
        logger.error('platform copy generation failed', { clipPlatformCopyId }, error);
        Sentry.captureException(error, { tags: { clipPlatformCopyId } });

        // No automatic BullMQ retry for this queue (same convention as
        // export-generate.worker.ts) - the row goes FAILED unconditionally;
        // the user re-triggers via a new POST /clips/:id/platform-copy.
        await prisma.clipPlatformCopy.update({
          where: { id: clipPlatformCopyId },
          data: {
            status: ClipPlatformCopyStatus.FAILED,
            failReason: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );
}
