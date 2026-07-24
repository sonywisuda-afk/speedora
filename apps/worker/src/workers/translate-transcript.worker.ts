import * as Sentry from '@sentry/node';
import { translateSegments } from '@speedora/subtitle-translate';
import { QueueName, type TranslateTranscriptJobData } from '@speedora/shared';
import { Worker, type Job } from 'bullmq';
import { forStage } from '../logger';
import { openai } from '../openai';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';

const logger = forStage('translate-transcript');

// Adapter (see root ARCHITECTURE.md's DB-vs-JSON-contract pattern): this
// file is the only place that touches Prisma/BullMQ/Sentry for this step -
// the actual LLM call/response-sanitization lives in the stateless
// @speedora/subtitle-translate module, tested purely with JSON fixtures.
// Subtitle Studio roadmap (P2f) - a brand-new, standalone LLM call, same
// "no dedicated status row, client polls the resource itself" shape
// TranslateTranscriptJobData's own comment documents (unlike
// GENERATE_PLATFORM_COPY's ClipPlatformCopy row) - a failure here just
// leaves `translations[languageCode]` unset on every segment, same as if
// the request had never been made; the user re-triggers via a new POST.
//
// No withJobTimeout here - same reasoning as generate-platform-copy.worker.ts:
// a single external LLM call, no self-chaining, apps/api-sole-producer.
export function createTranslateTranscriptWorker(): Worker<TranslateTranscriptJobData> {
  return new Worker<TranslateTranscriptJobData>(
    QueueName.TRANSLATE_TRANSCRIPT,
    async (job: Job<TranslateTranscriptJobData>) => {
      const { videoId, languageCode } = job.data;

      logger.info('translating transcript', { videoId, languageCode });

      const segments = await prisma.transcriptSegment.findMany({ where: { videoId } });
      if (segments.length === 0) {
        logger.info('no transcript segments for this video - nothing to translate', { videoId });
        return;
      }

      try {
        const { translations } = await translateSegments(
          { segments: segments.map((s) => ({ id: s.id, text: s.text })), languageCode },
          { openai },
        );

        const byId = new Map(segments.map((s) => [s.id, s]));
        // Per-segment updates (not one updateMany) since each row merges the
        // new language into its OWN existing `translations` map rather than
        // overwriting it - same "per-record isolation" posture as
        // sync-publish-stats.worker.ts's own per-record loop.
        await Promise.all(
          translations.map(({ id, text }) => {
            const existing = byId.get(id);
            const existingTranslations =
              (existing?.translations as Record<string, string> | null) ?? {};
            return prisma.transcriptSegment.update({
              where: { id },
              data: { translations: { ...existingTranslations, [languageCode]: text } },
            });
          }),
        );

        logger.info('transcript translated', {
          videoId,
          languageCode,
          translatedCount: translations.length,
          totalSegments: segments.length,
        });
      } catch (error) {
        logger.error('transcript translation failed', { videoId, languageCode }, error);
        Sentry.captureException(error, { tags: { videoId, languageCode } });
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );
}
