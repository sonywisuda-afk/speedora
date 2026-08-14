import * as Sentry from '@sentry/node';
import { selectShortlist } from '@speedora/candidate-shortlist';
import {
  CANDIDATE_EXPANSION_POOL_SIZE,
  isCandidateExpansionEnabled,
  scoreClipCandidates,
} from '@speedora/clip-scoring';
import type { ClipScoringCandidate, ClipScoringInput } from '@speedora/contracts';
import { updateVideoStatus, VideoStatus } from '@speedora/database';
import {
  filterSegmentsForClip,
  migrateProcessingOptions,
  QueueName,
  type DetectClipsJobData,
  type DetectClipsJobResult,
  type ProcessingOptions,
  type TranscriptSegment,
} from '@speedora/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { createCandidateClips, enqueueRendersForCandidates } from './clip-persistence';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { enqueueNotificationDelivery } from '../notificationDeliveryEnqueuer';
import { publishNotification } from '../notificationPublisher';
import { openai } from '../openai';
import { prisma } from '../prisma';
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
// Pre-Processing Settings roadmap (Phase 0/1) - translates the settings
// screen's clipCount/min/maxClipDurationSeconds (Video.processingOptions)
// into @speedora/clip-scoring's own maxCandidates/minClipSeconds/
// maxClipSeconds override fields. 'unlimited' maps to a very high cap
// rather than literally uncapped - the module always needs a real number to
// .slice() against. Every field left null/absent (including a video with
// no processingOptions at all - the common case for anything created before
// this roadmap) resolves to the module's own untouched defaults - see
// toScoringInput() below for the AI Intelligence v4 Phase 13.1 addition to
// that omitted-clipCount case. (Pre-Phase-13.1, the LLM's own system prompt
// hardcoded "Pick 1-3" regardless of maxCandidates, so raising this cap had
// no real effect - that bug is now fixed in @speedora/clip-scoring itself,
// see docs/ai/clip-ranking-engine.md.)
const UNLIMITED_CLIP_COUNT_CAP = 50;

// Render Fidelity Matrix bug fix #4 (docs/ai/render-fidelity-matrix.md) - extracted out of
// toScoringInput() so shortlistRawCandidates() below can resolve the SAME ceiling and pass it
// through to selectShortlist()'s own targetSize, instead of that stage silently falling back to
// its own hardcoded DEFAULT_SHORTLIST_TARGET_SIZE (15) regardless of what the user actually
// requested (clipCount: 20 or 'unlimited', both > 15) - one resolution, reused by both stages of
// the funnel, rather than two independent decisions that could silently disagree.
function resolveMaxCandidates(processingOptions: ProcessingOptions | null): number | undefined {
  const clipCount = processingOptions?.clipGeneration.clipCount;
  // AI Intelligence v4 Phase 13.1 (Clip Ranking Engine, see
  // docs/ai/clip-ranking-engine.md) - an explicit clipCount (a number or
  // 'unlimited') is always the user's own Pre-Processing Settings choice and
  // wins unconditionally, same as before this phase. Only the OMITTED case
  // (the common case - most videos have no processingOptions at all) now
  // considers isCandidateExpansionEnabled(): when on, it asks for the
  // funnel's Stage A pool size instead of silently falling through to
  // @speedora/clip-scoring's own small MAX_CANDIDATES default. Flag off (the
  // default) reproduces every pre-Phase-13 render exactly.
  return clipCount === 'unlimited'
    ? UNLIMITED_CLIP_COUNT_CAP
    : (clipCount ?? (isCandidateExpansionEnabled() ? CANDIDATE_EXPANSION_POOL_SIZE : undefined));
}

function toScoringInput(
  segments: TranscriptSegment[],
  processingOptions: ProcessingOptions | null,
): ClipScoringInput {
  const maxCandidates = resolveMaxCandidates(processingOptions);
  return {
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      words: segment.words,
    })),
    maxCandidates,
    minClipSeconds: processingOptions?.clipGeneration.minClipDurationSeconds ?? undefined,
    maxClipSeconds: processingOptions?.clipGeneration.maxClipDurationSeconds ?? undefined,
    // Pre-Processing Settings roadmap (Phase 2) - Section 7 (Highlight
    // Detection): a real pre-cap minimum and a real preferred-intents
    // reorder, both applied inside @speedora/clip-scoring itself (see that
    // module's own comment on why intent reweighting has to happen before
    // its own maxCandidates cap to have any real effect).
    minConfidence: processingOptions?.highlightFocus.confidenceThreshold ?? undefined,
    preferredIntents: processingOptions?.highlightFocus.intents,
  };
}

// emojiSuggestionsFor/resolveBrandKitFields/the clip-create + render-enqueue
// block that used to live here were extracted to ./clip-persistence.ts
// (Generate More Clips roadmap, Phase C) so generate-more-clips.worker.ts
// can reuse them without duplication - see that file's own module comment.

// AI Intelligence v4 Phase 13.2 (Clip Ranking Engine, Stage B - see
// docs/ai/clip-ranking-engine.md). Runs BEFORE createCandidateClips() below
// so a candidate that doesn't survive the shortlist never gets a Clip row
// or a render job at all - not a post-persistence filter/delete (ADR D18:
// non-destructive output only applies to what's already been created;
// candidates that never got that far were never "created" in the first
// place). @speedora/candidate-shortlist's own passthrough (pool already at
// or under its target) makes this a genuine no-op, zero extra LLM calls,
// whenever Phase 13.1's expansion isn't in play - the common case today.
//
// Render Fidelity Matrix bug fix #4 - targetSize is now the SAME
// resolveMaxCandidates() ceiling toScoringInput() asked the LLM for (undefined falls through to
// selectShortlist()'s own DEFAULT_SHORTLIST_TARGET_SIZE, this function's exact prior behavior).
// Previously this call passed no targetSize at all, so a user requesting clipCount: 20 (or
// 'unlimited') would still get silently capped at 15 by this stage even though the LLM was
// correctly asked for up to 20.
async function shortlistRawCandidates(
  rawCandidates: ClipScoringCandidate[],
  segments: TranscriptSegment[],
  processingOptions: ProcessingOptions | null,
): Promise<ClipScoringCandidate[]> {
  const { shortlisted } = await selectShortlist(
    {
      candidates: rawCandidates.map((candidate) => ({
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        scores: candidate.scores,
        viralityScore: candidate.viralityScore,
        segments: filterSegmentsForClip(segments, candidate.startTime, candidate.endTime).map(
          (segment) => ({ start: segment.start, end: segment.end, text: segment.text }),
        ),
      })),
      targetSize: resolveMaxCandidates(processingOptions),
    },
    { openai },
  );
  return shortlisted.map((entry) => rawCandidates[entry.index]);
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
            select: { status: true, processingOptions: true },
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
            const processingOptions = existingVideo.processingOptions
              ? migrateProcessingOptions(existingVideo.processingOptions)
              : null;
            const { candidates: rawCandidates } = await scoreClipCandidates(
              toScoringInput(segments, processingOptions),
              {
                openai,
              },
            );

            // AI Intelligence v4 Phase 13.2 (Clip Ranking Engine, Stage B) -
            // see shortlistRawCandidates()'s own comment.
            const shortlistedCandidates = await shortlistRawCandidates(
              rawCandidates,
              segments,
              processingOptions,
            );

            // Generate More Clips roadmap (Phase C) - clip creation and
            // render-enqueue now live in ./clip-persistence.ts, shared with
            // generate-more-clips.worker.ts. Split into two calls (not one)
            // specifically to preserve this exact ordering: clips must exist
            // before the CLIPS_DETECTED status write below, and renders must
            // only be enqueued after it - see clip-persistence.ts's own
            // module comment.
            const { clips, candidates } = await createCandidateClips(
              videoId,
              shortlistedCandidates,
              segments,
              processingOptions,
            );

            await updateVideoStatus(
              prisma,
              videoId,
              VideoStatus.CLIPS_DETECTED,
              {},
              { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
            );

            logger.info('video analyzed', { videoId, candidateCount: candidates.length });

            if (candidates.length > 0) {
              await enqueueRendersForCandidates(videoId, clips, candidates, processingOptions);
            }

            return { videoId, candidates };
          } catch (error) {
            // Reliability hardening pass, same coordination as
            // probe-video.worker.ts/transcribe.worker.ts/render-clip.worker.ts:
            // no UnrecoverableError is thrown in this file today (the LLM
            // call and JSON parsing happen inside @speedora/clip-scoring,
            // out of this worker's own visibility, and zero candidates is
            // already a valid non-error outcome, not a failure path) -
            // every failure here defaults retryable, gated on whether this
            // is genuinely the last BullMQ attempt.
            const isRetryable = !(error instanceof UnrecoverableError);
            const attemptNumber = job.attemptsMade + 1;
            const maxAttempts = job.opts.attempts ?? 1;
            const isFinalAttempt = !isRetryable || attemptNumber >= maxAttempts;

            logger.error(
              'video failed',
              { videoId, attempt: attemptNumber, maxAttempts, willRetry: !isFinalAttempt },
              error,
            );
            // Tags only - never the transcript text or OPENAI_API_KEY.
            Sentry.captureException(error, { tags: { videoId } });

            // Only write the terminal FAILED status once this is genuinely
            // the last attempt - leaving Video.status at TRANSCRIBED on a
            // non-final attempt is what lets the idempotency guard above
            // pass on BullMQ's next attempt instead of skipping it as
            // "already past TRANSCRIBED".
            if (isFinalAttempt) {
              await updateVideoStatus(
                prisma,
                videoId,
                VideoStatus.FAILED,
                { errorMessage: error instanceof Error ? error.message : String(error) },
                { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
              );
            }
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
