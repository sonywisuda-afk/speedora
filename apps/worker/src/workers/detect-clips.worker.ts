import * as Sentry from '@sentry/node';
import { scoreClipCandidates } from '@speedora/clip-scoring';
import type { ClipScoringInput } from '@speedora/contracts';
import { updateVideoStatus, VideoStatus, type Prisma } from '@speedora/database';
import { suggestEmojis } from '@speedora/emoji-suggester';
import {
  filterSegmentsForClip,
  QueueName,
  type ClipCandidate,
  type ClipScores,
  type DetectClipsJobData,
  type DetectClipsJobResult,
  type TranscriptSegment,
} from '@speedora/shared';
import { Worker, type Job } from 'bullmq';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { publishNotification } from '../notificationPublisher';
import { openai } from '../openai';
import { prisma } from '../prisma';
import { renderClipQueue } from '../queues';
import { createRedisConnection } from '../redis';

// Defense-in-depth outer bound (see jobTimeout.ts) - a single LLM call over
// the full transcript, already bounded by the OpenAI SDK's own ~10 min
// default request timeout; generous headroom above that for the
// scoring/filtering/DB-write work around it.
const DETECT_CLIPS_JOB_TIMEOUT_MS = 15 * 60 * 1000;

const logger = forStage('detect-clips');

// Adapter (see root ARCHITECTURE.md's DB-vs-JSON-contract pattern): this file
// is the only place that touches Prisma/BullMQ/Sentry for the detect-clips
// step. All of the actual candidate-picking logic (the LLM call, filtering,
// sanitization, Smart Start/End snapping) lives in the stateless
// @speedora/clip-scoring module - it never sees a Prisma client and is tested
// purely with JSON fixtures (see its own spec file).

// Narrows a DB-shaped TranscriptSegment (which also carries speaker/emotion
// labels the scoring module never reads) down to the module's own, smaller
// input contract - the module should never need to know a TranscriptSegment
// row exists.
function toScoringInput(segments: TranscriptSegment[]): ClipScoringInput {
  return {
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      words: segment.words,
    })),
  };
}

// Fase 23 (DB+JSON-contract roadmap, Fase 4 - a brand-new feature built
// purely via the checklist) - @speedora/emoji-suggester's whole input is
// one plain string, so the adapter's job is just narrowing this candidate's
// overlapping transcript segments down to their joined text.
function emojiSuggestionsFor(
  segments: TranscriptSegment[],
  startTime: number,
  endTime: number,
): string[] {
  const text = filterSegmentsForClip(segments, startTime, endTime)
    .map((segment) => segment.text)
    .join(' ');
  return suggestEmojis({ text }).emojis;
}

export function createDetectClipsWorker(): Worker<DetectClipsJobData, DetectClipsJobResult> {
  return new Worker<DetectClipsJobData, DetectClipsJobResult>(
    QueueName.DETECT_CLIPS,
    (job: Job<DetectClipsJobData>) =>
      withJobTimeout(
        async () => {
          const { videoId, segments } = job.data;

          // Same orphaned-job guard as transcribe.worker.ts - a video deleted
          // while this job was still queued would otherwise burn a real OpenAI
          // API call before failing on the final prisma write.
          const existingVideo = await prisma.video.findUnique({
            where: { id: videoId },
            select: { status: true },
          });
          if (!existingVideo) {
            logger.info('video was deleted - skipping orphaned job', { videoId });
            return { videoId, candidates: [] };
          }

          // Same idempotency guard/reasoning as transcribe.worker.ts (see its own comment) - both
          // callers of this queue (transcribe.worker.ts, VideosService.retry) only enqueue right after
          // setting status to TRANSCRIBED, so status having already moved past it means some execution
          // of this same job already ran scoreClipCandidates() - a paid LLM call - and re-running it via
          // a BullMQ stalled-job re-processing would just duplicate that cost.
          if (existingVideo.status !== VideoStatus.TRANSCRIBED) {
            logger.info(
              'video is already past TRANSCRIBED - skipping to avoid a duplicate LLM call',
              { videoId, status: existingVideo.status },
            );
            return { videoId, candidates: [] };
          }

          logger.info('analyzing transcript segments', { videoId, segmentCount: segments.length });

          try {
            const { candidates: rawCandidates } = await scoreClipCandidates(
              toScoringInput(segments),
              {
                openai,
              },
            );

            const clips = await prisma.$transaction(
              rawCandidates.map((candidate) =>
                prisma.clip.create({
                  data: {
                    videoId,
                    startTime: candidate.startTime,
                    endTime: candidate.endTime,
                    viralityScore: candidate.viralityScore,
                    hookText: candidate.hookText,
                    hashtags: candidate.hashtags,
                    // ClipScores is a closed interface (no index signature), which
                    // Prisma's Json input type requires - same reasoning as
                    // clip.scores's read-side cast to ClipScores below.
                    scores: candidate.scores as unknown as Prisma.InputJsonValue,
                    reason: candidate.reason,
                    topics: candidate.topics,
                    keywords: candidate.keywords,
                    intent: candidate.intent,
                    ctaText: candidate.ctaText,
                    emojiSuggestions: emojiSuggestionsFor(
                      segments,
                      candidate.startTime,
                      candidate.endTime,
                    ),
                  },
                }),
              ),
            );

            await updateVideoStatus(prisma, videoId, VideoStatus.CLIPS_DETECTED);

            const candidates: ClipCandidate[] = clips.map((clip) => ({
              id: clip.id,
              videoId: clip.videoId,
              startTime: clip.startTime,
              endTime: clip.endTime,
              viralityScore: clip.viralityScore,
              transcript: filterSegmentsForClip(segments, clip.startTime, clip.endTime),
              hookText: clip.hookText,
              hashtags: clip.hashtags,
              // Prisma types a Json column as the opaque JsonValue union - this
              // narrows it back to the shape written above (same pattern as
              // transcript-segment.util.ts's toSharedTranscriptSegment for
              // TranscriptSegment.words).
              scores: (clip.scores as unknown as ClipScores) ?? null,
              reason: clip.reason,
              topics: clip.topics,
              keywords: clip.keywords,
              intent: clip.intent,
              ctaText: clip.ctaText,
              emojiSuggestions: clip.emojiSuggestions,
            }));

            logger.info('video analyzed', { videoId, candidateCount: candidates.length });

            if (candidates.length > 0) {
              const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
              await Promise.all(
                candidates.map((candidate, index) =>
                  renderClipQueue.add(QueueName.RENDER_CLIP, {
                    clipId: candidate.id,
                    videoId: candidate.videoId,
                    sourceUrl: video.sourceUrl,
                    startTime: candidate.startTime,
                    endTime: candidate.endTime,
                    transcript: candidate.transcript,
                    // Newly-created clips always start at the schema default
                    // (CaptionStyle.DEFAULT) - picking a non-default preset is a
                    // manual PATCH /clips/:id + re-render, same flow as a manual
                    // trim (see ClipsService.update/.render).
                    captionStyle: clips[index].captionStyle,
                    keywords: candidate.keywords,
                    scores: candidate.scores,
                  }),
                ),
              );
            }

            return { videoId, candidates };
          } catch (error) {
            logger.error('video failed', { videoId }, error);
            // Tags only - never the transcript text or OPENAI_API_KEY.
            Sentry.captureException(error, { tags: { videoId } });
            await updateVideoStatus(
              prisma,
              videoId,
              VideoStatus.FAILED,
              { errorMessage: error instanceof Error ? error.message : String(error) },
              { publish: publishNotification },
            );
            throw error;
          }
        },
        DETECT_CLIPS_JOB_TIMEOUT_MS,
        `detect-clips:${job.data.videoId}`,
      ),
    {
      connection: createRedisConnection(),
      // Explicit, not the implicit default - same "one at a time per worker
      // process, raise only after a real capacity-planning decision" reasoning
      // as transcribe.worker.ts.
      concurrency: 1,
      // Comfortably above this job's worst-case real duration (an LLM call
      // over the full transcript) - same BullMQ stalled-job mis-detection
      // reasoning as transcribe.worker.ts.
      lockDuration: 20 * 60 * 1000,
    },
  );
}
