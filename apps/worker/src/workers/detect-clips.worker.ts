import * as Sentry from '@sentry/node';
import { scoreClipCandidates } from '@speedora/clip-scoring';
import type { ClipScoringInput } from '@speedora/contracts';
import { VideoStatus, type Prisma } from '@speedora/database';
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
import { openai } from '../openai';
import { prisma } from '../prisma';
import { renderClipQueue } from '../queues';
import { createRedisConnection } from '../redis';

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

export function createDetectClipsWorker(): Worker<DetectClipsJobData, DetectClipsJobResult> {
  return new Worker<DetectClipsJobData, DetectClipsJobResult>(
    QueueName.DETECT_CLIPS,
    async (job: Job<DetectClipsJobData>) => {
      const { videoId, segments } = job.data;
      console.log(`[detect-clips] analyzing ${segments.length} segments for video ${videoId}`);

      try {
        const { candidates: rawCandidates } = await scoreClipCandidates(toScoringInput(segments), {
          openai,
        });

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
              },
            }),
          ),
        );

        await prisma.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.CLIPS_DETECTED },
        });

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
        }));

        console.log(`[detect-clips] video ${videoId} -> ${candidates.length} candidates`);

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
              }),
            ),
          );
        }

        return { videoId, candidates };
      } catch (error) {
        console.error(`[detect-clips] video ${videoId} failed:`, error);
        // Tags only - never the transcript text or OPENAI_API_KEY.
        Sentry.captureException(error, { tags: { videoId } });
        await prisma.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.FAILED },
        });
        throw error;
      }
    },
    { connection: createRedisConnection() },
  );
}
