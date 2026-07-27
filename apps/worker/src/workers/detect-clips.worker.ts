import * as Sentry from '@sentry/node';
import { scoreClipCandidates } from '@speedora/clip-scoring';
import type { ClipScoringInput } from '@speedora/contracts';
import { updateVideoStatus, VideoStatus, type Prisma } from '@speedora/database';
import { suggestEmojis } from '@speedora/emoji-suggester';
import {
  filterSegmentsForClip,
  mergeBrandKitFields,
  migrateProcessingOptions,
  QueueName,
  templateToBrandKitFields,
  type BrandKitFields,
  type ClipCandidate,
  type ClipScores,
  type DetectClipsJobData,
  type DetectClipsJobResult,
  type IntroType,
  type ProcessingOptions,
  type RenderClipJobData,
  type TranscriptSegment,
  type WatermarkPosition,
} from '@speedora/shared';
import { Worker, type Job } from 'bullmq';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { enqueueNotificationDelivery } from '../notificationDeliveryEnqueuer';
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

// Watermark roadmap (P3c) - same defaults as ClipsService's own
// DEFAULT_WATERMARK_* constants, duplicated here rather than shared - same
// "each render-enqueue site inlines its own resolution" convention the
// fontFamily precedence already established.
const DEFAULT_WATERMARK_OPACITY = 0.8;
const DEFAULT_WATERMARK_SCALE = 0.15;
const DEFAULT_WATERMARK_MARGIN = 0.03;
const DEFAULT_WATERMARK_POSITION: WatermarkPosition = 'BOTTOM_RIGHT';

// Workspace-level Brand Kit roadmap (P3g) - same shape as ClipsService's
// own BRAND_KIT_SELECT (apps/api), inlined here for the same "each
// render-enqueue site resolves its own Brand Kit reads independently"
// reasoning as the DEFAULT_WATERMARK_* constants above.
const BRAND_KIT_SELECT = {
  brandLogoUrl: true,
  brandPrimaryColor: true,
  brandSecondaryColor: true,
  brandFontFamily: true,
  brandWatermarkUrl: true,
  brandWatermarkOpacity: true,
  brandWatermarkScale: true,
  brandWatermarkMargin: true,
  brandWatermarkPosition: true,
  brandIntroUrl: true,
  brandIntroType: true,
  brandIntroImageDurationSeconds: true,
  brandOutroUrl: true,
  brandOutroType: true,
  brandOutroImageDurationSeconds: true,
} as const;

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
// .slice() against, and the LLM itself is already asked for "1-3" clips in
// its system prompt regardless, so this just removes this adapter's own
// additional ceiling. Every field left null/absent (including a video with
// no processingOptions at all - the common case for anything created before
// this roadmap) resolves to the module's own untouched defaults.
const UNLIMITED_CLIP_COUNT_CAP = 50;

function toScoringInput(
  segments: TranscriptSegment[],
  processingOptions: ProcessingOptions | null,
): ClipScoringInput {
  const clipCount = processingOptions?.clipGeneration.clipCount;
  return {
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      words: segment.words,
    })),
    maxCandidates: clipCount === 'unlimited' ? UNLIMITED_CLIP_COUNT_CAP : (clipCount ?? undefined),
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

// Pre-Processing Settings roadmap (Phase 3) - resolves this video's
// EFFECTIVE Brand Kit: a chosen BrandKitTemplate (Section 17) when
// processingOptions names one and it's actually owned by this video's
// owner, otherwise the existing live User/Workspace merge (Workspace-level
// Brand Kit roadmap P3g, unchanged). Choosing a template here never
// mutates anyone's live Brand Kit - it only affects this video's own
// clips, deliberately different from BrandKitService.applyTemplate()'s
// existing copy-onto-live-row endpoint. A stale/deleted/not-owned
// templateId falls back rather than failing the job - same "optional
// signal, never fail the render" posture watermark/intro/outro downloads
// already have.
async function resolveBrandKitFields(
  video: { id: string; ownerId: string; workspaceId: string },
  processingOptions: ProcessingOptions | null,
): Promise<BrandKitFields> {
  const templateId = processingOptions?.brandKit.templateId;
  if (templateId) {
    const template = await prisma.brandKitTemplate.findUnique({ where: { id: templateId } });
    if (template && template.userId === video.ownerId) {
      return templateToBrandKitFields(template);
    }
    logger.warn(
      'processingOptions named a Brand Kit template that no longer exists or is not owned ' +
        'by this video - falling back to the live Brand Kit',
      { videoId: video.id, templateId },
    );
  }

  // Workspace-level Brand Kit roadmap (P3g) - merges the video's workspace
  // Brand Kit over the owner's personal one, same "resolve once, skip the
  // Workspace fetch when it's the owner's personal workspace" shape as
  // ClipsService.resolveEffectiveBrandKit.
  const [workspace, owner] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: video.workspaceId },
      select: { isPersonal: true, ...BRAND_KIT_SELECT },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: video.ownerId },
      select: BRAND_KIT_SELECT,
    }),
  ]);
  return mergeBrandKitFields(workspace.isPersonal ? null : workspace, owner);
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

            const clips = await prisma.$transaction(
              rawCandidates.map((candidate) =>
                prisma.clip.create({
                  data: {
                    videoId,
                    startTime: candidate.startTime,
                    endTime: candidate.endTime,
                    durationSeconds: candidate.endTime - candidate.startTime,
                    viralityScore: candidate.viralityScore,
                    hookText: candidate.hookText,
                    hashtags: candidate.hashtags,
                    // Pre-Processing Settings roadmap (Phase 0/1) - same 3
                    // fields a SubtitlePreset bulk-sets, applied as this
                    // video's default rather than left at the schema's own
                    // DEFAULT/false/null. Omitted entirely (schema defaults
                    // apply) when processingOptions is null - the common
                    // case for anything created before this roadmap.
                    ...(processingOptions
                      ? {
                          captionStyle: processingOptions.subtitle.captionStyle,
                          speakerColorCaptions: processingOptions.subtitle.speakerColorCaptions,
                          fontFamily: processingOptions.subtitle.fontFamily,
                          // Pre-Processing Settings roadmap (Phase 3) - the
                          // first way to opt a whole video's clips out of
                          // Brand Kit up front, rather than a manual
                          // per-clip PATCH after the fact.
                          applyBrandKit: processingOptions.brandKit.applyBrandKit,
                        }
                      : {}),
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

            await updateVideoStatus(
              prisma,
              videoId,
              VideoStatus.CLIPS_DETECTED,
              {},
              { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
            );

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
              // Brand Kit roadmap (P3a) - newly-created clips always start at
              // the schema default (applyBrandKit: true, same reasoning as
              // captionStyle's own comment below), so this is effectively
              // unconditional here - still gated on clips[index].applyBrandKit
              // for consistency with ClipsService.render()/VideosService.retry.
              const brandKit = await resolveBrandKitFields(video, processingOptions);
              const ownerWatermark: RenderClipJobData['watermark'] = brandKit.brandWatermarkUrl
                ? {
                    key: brandKit.brandWatermarkUrl,
                    opacity: brandKit.brandWatermarkOpacity ?? DEFAULT_WATERMARK_OPACITY,
                    scale: brandKit.brandWatermarkScale ?? DEFAULT_WATERMARK_SCALE,
                    margin: brandKit.brandWatermarkMargin ?? DEFAULT_WATERMARK_MARGIN,
                    position:
                      (brandKit.brandWatermarkPosition as WatermarkPosition | null) ??
                      DEFAULT_WATERMARK_POSITION,
                  }
                : null;
              // Intro roadmap (P3d) - same shape as ownerWatermark above.
              const ownerIntro: RenderClipJobData['intro'] =
                brandKit.brandIntroUrl && brandKit.brandIntroType
                  ? {
                      key: brandKit.brandIntroUrl,
                      type: brandKit.brandIntroType as IntroType,
                      imageDurationSeconds: brandKit.brandIntroImageDurationSeconds,
                    }
                  : null;
              // Outro roadmap (P3e) - same shape as ownerIntro above.
              const ownerOutro: RenderClipJobData['outro'] =
                brandKit.brandOutroUrl && brandKit.brandOutroType
                  ? {
                      key: brandKit.brandOutroUrl,
                      type: brandKit.brandOutroType as IntroType,
                      imageDurationSeconds: brandKit.brandOutroImageDurationSeconds,
                    }
                  : null;
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
                    speakerColorCaptions: clips[index].speakerColorCaptions,
                    captionLanguage: clips[index].captionLanguage,
                    // Subtitle Presets roadmap (P3b) - clips[index].fontFamily
                    // is always null for a brand-new clip (schema default),
                    // so this is Brand-Kit-driven in practice here - written
                    // the same precedence-checking way as
                    // ClipsService.resolveFontFamily/VideosService.retry for
                    // consistency, not because it currently branches.
                    fontFamily:
                      clips[index].fontFamily ??
                      (clips[index].applyBrandKit ? brandKit.brandFontFamily : null),
                    // Watermark roadmap (P3c) - clips[index].watermarkEnabled
                    // is always true for a brand-new clip (schema default),
                    // so this is Brand-Kit-driven in practice here, same
                    // "always true, written for precedence consistency
                    // anyway" reasoning as fontFamily's own comment above.
                    watermark: clips[index].watermarkEnabled ? ownerWatermark : null,
                    // Intro roadmap (P3d) - same "always true for a
                    // brand-new clip, Brand-Kit-driven in practice" reasoning
                    // as watermark above.
                    intro: clips[index].introEnabled ? ownerIntro : null,
                    outro: clips[index].outroEnabled ? ownerOutro : null,
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
              { publish: publishNotification, enqueueDelivery: enqueueNotificationDelivery },
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
