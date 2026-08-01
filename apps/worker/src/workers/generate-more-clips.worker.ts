import * as Sentry from '@sentry/node';
import { filterOverlappingCandidates, scoreClipCandidates } from '@speedora/clip-scoring';
import type { ClipScoringSegment } from '@speedora/contracts';
import { recordNotification, VideoStatus } from '@speedora/database';
import {
  migrateProcessingOptions,
  QueueName,
  type GenerateMoreClipsJobData,
  type GenerateMoreClipsJobResult,
  type TranscriptSegment,
  type TranscriptWord,
} from '@speedora/shared';
import { Worker, type Job } from 'bullmq';
import { createCandidateClips, enqueueRendersForCandidates } from './clip-persistence';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { enqueueNotificationDelivery } from '../notificationDeliveryEnqueuer';
import { publishNotification } from '../notificationPublisher';
import { openai } from '../openai';
import { prisma } from '../prisma';
import { createRedisConnection } from '../redis';

// Adapter for the Generate More Clips roadmap (Phase C) - see the plan's
// Phase C.0/C.1 audit: reuses the video's already-persisted transcript
// (TranscriptSegment) the exact same way detect-clips.worker.ts's original
// selection does, never re-runs transcription/scene/facial/OCR/fusion work,
// and shares clip-creation/render-enqueue with detect-clips.worker.ts via
// ./clip-persistence.ts. Deliberately its own queue/worker, not a re-use of
// DETECT_CLIPS - see QueueName.GENERATE_MORE_CLIPS's own comment for why.

// Same cost profile as detect-clips.worker.ts's own timeout - one LLM call
// over the full transcript.
const GENERATE_MORE_CLIPS_JOB_TIMEOUT_MS = 15 * 60 * 1000;

const logger = forStage('generate-more-clips');

// Mirrors apps/api/src/videos/transcript-segment.util.ts's
// toSharedTranscriptSegment. Can't import it directly - apps/api and
// apps/worker are separate apps that only share code via packages/ - so
// this is a small, deliberate duplicate. No other apps/worker file has
// needed this before: every existing worker's segments arrive pre-hydrated
// on the job payload (see TranscribeJobResult/DetectClipsJobData); this is
// the first to query TranscriptSegment rows directly, since Generate More
// Clips has nothing to carry them on (see GenerateMoreClipsJobData's own
// comment on why it's id-plus-params, not id-only-with-a-snapshot).
function toTranscriptSegment(row: {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  emotion: string | null;
  words: unknown;
  rmsDb: number | null;
  peakDb: number | null;
  speakingRateWordsPerSecond: number | null;
}): TranscriptSegment {
  return {
    id: row.id,
    start: row.start,
    end: row.end,
    text: row.text,
    speaker: row.speaker ?? undefined,
    emotion: row.emotion ?? undefined,
    words: Array.isArray(row.words) ? (row.words as unknown as TranscriptWord[]) : undefined,
    rmsDb: row.rmsDb ?? undefined,
    peakDb: row.peakDb ?? undefined,
    speakingRateWordsPerSecond: row.speakingRateWordsPerSecond ?? undefined,
  };
}

export function createGenerateMoreClipsWorker(): Worker<
  GenerateMoreClipsJobData,
  GenerateMoreClipsJobResult
> {
  return new Worker<GenerateMoreClipsJobData, GenerateMoreClipsJobResult>(
    QueueName.GENERATE_MORE_CLIPS,
    (job: Job<GenerateMoreClipsJobData>) =>
      withJobTimeout(
        async () => {
          const {
            videoId,
            requestedCount,
            minClipDurationSeconds,
            maxClipDurationSeconds,
            minConfidence,
            avoidOverlap,
          } = job.data;

          // Orphaned-job guard, same reasoning as detect-clips.worker.ts's own
          // (and transcribe.worker.ts's before it).
          const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, ownerId: true, title: true, status: true, processingOptions: true },
          });
          if (!video) {
            logger.info('video was deleted - skipping orphaned job', { videoId });
            return { videoId, candidateCount: 0 };
          }

          // Defensive re-check - VideosService.generateMore already validated
          // the video is RENDERED and not mid-render synchronously right
          // before enqueueing this job. Re-checking here guards only against
          // the (very unlikely) case where that state changed in the window
          // between enqueue and this job actually running - skip rather than
          // fail loudly, same "orphaned job, not an error" posture as above.
          if (video.status !== VideoStatus.RENDERED) {
            logger.info(
              'video is not RENDERED - skipping (state changed between enqueue and processing)',
              { videoId, status: video.status },
            );
            return { videoId, candidateCount: 0 };
          }

          const [rawSegments, existingClips] = await Promise.all([
            prisma.transcriptSegment.findMany({ where: { videoId }, orderBy: { start: 'asc' } }),
            prisma.clip.findMany({
              where: { videoId },
              select: { startTime: true, endTime: true },
            }),
          ]);
          const segments = rawSegments.map(toTranscriptSegment);
          const excludeRanges = existingClips.map((clip) => ({
            start: clip.startTime,
            end: clip.endTime,
          }));
          const processingOptions = video.processingOptions
            ? migrateProcessingOptions(video.processingOptions)
            : null;

          logger.info('generating more clips', {
            videoId,
            requestedCount,
            existingClipCount: existingClips.length,
          });

          try {
            const scoringSegments: ClipScoringSegment[] = segments.map((segment) => ({
              start: segment.start,
              end: segment.end,
              text: segment.text,
              words: segment.words,
            }));

            const { candidates: rawCandidates } = await scoreClipCandidates(
              {
                segments: scoringSegments,
                maxCandidates: requestedCount,
                minClipSeconds: minClipDurationSeconds,
                maxClipSeconds: maxClipDurationSeconds,
                minConfidence,
                excludeRanges,
              },
              { openai },
            );

            // Authoritative overlap guard (see filterOverlappingCandidates'
            // own comment) - scoreClipCandidates' excludeRanges is a prompt
            // hint only. Skipped entirely when the user explicitly turned
            // "Hindari overlap" off in the dialog.
            const filteredCandidates = avoidOverlap
              ? filterOverlappingCandidates(rawCandidates, excludeRanges)
              : rawCandidates;

            if (filteredCandidates.length === 0) {
              logger.info('no new non-overlapping candidates found', { videoId });
              await recordNotification(
                prisma,
                {
                  userId: video.ownerId,
                  type: 'GENERATE_MORE_NO_CANDIDATES',
                  title: 'Tidak ada klip tambahan ditemukan',
                  body: video.title
                    ? `Tidak ditemukan momen baru yang cukup berbeda dari klip yang sudah ada di "${video.title}".`
                    : 'Tidak ditemukan momen baru yang cukup berbeda dari klip yang sudah ada di video ini.',
                  videoId,
                },
                { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
              ).catch((error) => {
                logger.warn(
                  'failed to record GENERATE_MORE_NO_CANDIDATES notification',
                  { videoId },
                  error,
                );
              });
              return { videoId, candidateCount: 0 };
            }

            // Deliberately no Video.status transition anywhere in this worker
            // (unlike detect-clips.worker.ts's CLIPS_DETECTED write) - a
            // RENDERED video stays RENDERED throughout Generate More. "In
            // progress" is signaled purely by the new clips' outputUrl being
            // null, the same signal VideosService.retry/generateMore already
            // use to infer pipeline state - see clip-persistence.ts's own
            // module comment for why this requires createCandidateClips and
            // enqueueRendersForCandidates to be two separate calls.
            const { clips, candidates } = await createCandidateClips(
              videoId,
              filteredCandidates,
              segments,
              processingOptions,
            );

            await enqueueRendersForCandidates(videoId, clips, candidates, processingOptions);

            logger.info('generated more clips', { videoId, candidateCount: candidates.length });

            return { videoId, candidateCount: candidates.length };
          } catch (error) {
            logger.error('generate more clips failed', { videoId }, error);
            // Tags only - never the transcript text or OPENAI_API_KEY.
            Sentry.captureException(error, { tags: { videoId } });
            // Deliberately no updateVideoStatus(FAILED) here, unlike
            // detect-clips.worker.ts's catch block - a failed Generate More
            // attempt must never mark the whole VIDEO as FAILED, since its
            // existing clips are all still RENDERED and fine; that would
            // incorrectly read as the original processing having broken.
            // The thrown error still fails the BullMQ job (visible in
            // /workers monitoring) and is still reported to Sentry.
            throw error;
          }
        },
        GENERATE_MORE_CLIPS_JOB_TIMEOUT_MS,
        `generate-more-clips:${job.data.videoId}`,
      ),
    {
      connection: createRedisConnection(),
      // Explicit, not the implicit default - same "one at a time per worker
      // process, raise only after a real capacity-planning decision"
      // reasoning as detect-clips.worker.ts.
      concurrency: 1,
      // Comfortably above this job's worst-case real duration (an LLM call
      // over the full transcript) - same BullMQ stalled-job mis-detection
      // reasoning as detect-clips.worker.ts.
      lockDuration: 20 * 60 * 1000,
    },
  );
}
