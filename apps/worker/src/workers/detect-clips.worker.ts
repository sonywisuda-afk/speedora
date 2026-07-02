import { VideoStatus } from '@viral-clip-app/database';
import {
  filterSegmentsForClip,
  QueueName,
  type ClipCandidate,
  type DetectClipsJobData,
  type DetectClipsJobResult,
  type TranscriptSegment,
} from '@viral-clip-app/shared';
import { Worker, type Job } from 'bullmq';
import { openai } from '../openai';
import { prisma } from '../prisma';
import { renderClipQueue } from '../queues';
import { createRedisConnection } from '../redis';

const MAX_CANDIDATES = 3;

interface RawCandidate {
  startTime: number;
  endTime: number;
  viralityScore: number;
}

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'clip_candidates',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startTime: { type: 'number' },
              endTime: { type: 'number' },
              viralityScore: { type: 'number' },
            },
            required: ['startTime', 'endTime', 'viralityScore'],
            additionalProperties: false,
          },
        },
      },
      required: ['candidates'],
      additionalProperties: false,
    },
  },
} as const;

async function detectCandidates(segments: TranscriptSegment[]): Promise<RawCandidate[]> {
  if (segments.length === 0) {
    return [];
  }

  const videoStart = Math.min(...segments.map((segment) => segment.start));
  const videoEnd = Math.max(...segments.map((segment) => segment.end));
  const transcriptText = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join('\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You select the most engaging, shareable moments from a video transcript for ' +
          'short-form vertical clips (TikTok/Reels/Shorts). Pick 1-3 non-overlapping clips, ' +
          `each between 5 and 60 seconds long, using only timestamps within ${videoStart.toFixed(1)}-${videoEnd.toFixed(1)} ` +
          'seconds. Score each clip 0-100 for how likely it is to go viral.',
      },
      {
        role: 'user',
        content: `Transcript:\n${transcriptText}`,
      },
    ],
    response_format: RESPONSE_FORMAT,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as { candidates: RawCandidate[] };

  return parsed.candidates
    .filter(
      (candidate) =>
        candidate.endTime > candidate.startTime &&
        candidate.startTime >= videoStart &&
        candidate.endTime <= videoEnd,
    )
    .map((candidate) => ({
      ...candidate,
      viralityScore: Math.max(0, Math.min(100, candidate.viralityScore)),
    }))
    .sort((a, b) => b.viralityScore - a.viralityScore)
    .slice(0, MAX_CANDIDATES);
}

export function createDetectClipsWorker(): Worker<DetectClipsJobData, DetectClipsJobResult> {
  return new Worker<DetectClipsJobData, DetectClipsJobResult>(
    QueueName.DETECT_CLIPS,
    async (job: Job<DetectClipsJobData>) => {
      const { videoId, segments } = job.data;
      console.log(`[detect-clips] analyzing ${segments.length} segments for video ${videoId}`);

      try {
        const rawCandidates = await detectCandidates(segments);

        const clips = await prisma.$transaction(
          rawCandidates.map((candidate) =>
            prisma.clip.create({
              data: {
                videoId,
                startTime: candidate.startTime,
                endTime: candidate.endTime,
                viralityScore: candidate.viralityScore,
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
        }));

        console.log(`[detect-clips] video ${videoId} -> ${candidates.length} candidates`);

        if (candidates.length > 0) {
          const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
          await Promise.all(
            candidates.map((candidate) =>
              renderClipQueue.add(QueueName.RENDER_CLIP, {
                clipId: candidate.id,
                videoId: candidate.videoId,
                sourceUrl: video.sourceUrl,
                startTime: candidate.startTime,
                endTime: candidate.endTime,
                transcript: candidate.transcript,
              }),
            ),
          );
        }

        return { videoId, candidates };
      } catch (error) {
        console.error(`[detect-clips] video ${videoId} failed:`, error);
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
