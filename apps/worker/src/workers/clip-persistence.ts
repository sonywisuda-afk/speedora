import type { ClipScoringCandidate } from '@speedora/contracts';
import { type Prisma } from '@speedora/database';
import { suggestEmojis } from '@speedora/emoji-suggester';
import {
  filterSegmentsForClip,
  mergeBrandKitFields,
  QueueName,
  RENDER_CLIP_RETRY_OPTIONS,
  templateToBrandKitFields,
  type BrandKitFields,
  type ClipCandidate,
  type ClipScores,
  type IntroType,
  type ProcessingOptions,
  type RenderClipJobData,
  type TranscriptSegment,
  type WatermarkPosition,
} from '@speedora/shared';
import { forStage } from '../logger';
import { prisma } from '../prisma';
import { renderClipQueue } from '../queues';

// Extracted from detect-clips.worker.ts (Generate More Clips roadmap, Phase
// C) so generate-more-clips.worker.ts can reuse the exact same clip-creation
// and render-enqueue logic without duplicating it - detect-clips.worker.ts's
// own behavior is unchanged, this is purely a code move. Split into two
// functions (not one) because detect-clips.worker.ts writes
// Video.status = CLIPS_DETECTED BETWEEN clip-creation and render-enqueue,
// and that status transition is specific to the original detect-clips flow
// (generate-more-clips.worker.ts never touches Video.status at all - see
// its own module comment) - preserving that exact ordering requires the
// caller to be able to run its own step in between.

const logger = forStage('clip-persistence');

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

// Fase 23 (DB+JSON-contract roadmap, Fase 4 - a brand-new feature built
// purely via the checklist) - @speedora/emoji-suggester's whole input is
// one plain string, so the adapter's job is just narrowing this candidate's
// overlapping transcript segments down to their joined text.
export function emojiSuggestionsFor(
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
export async function resolveBrandKitFields(
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

type CreatedClip = Awaited<ReturnType<typeof prisma.clip.create>>;

// Step 1 of 2: creates one Clip row per candidate (schema defaults for
// caption/brand-kit fields when processingOptions is null, same as before)
// and maps them into the ClipCandidate shape callers need for rendering.
// Returns the raw Clip rows too (index-aligned with candidates) since
// enqueueRendersForCandidates below needs their captionStyle/
// speakerColorCaptions/fontFamily/applyBrandKit/watermarkEnabled/
// introEnabled/outroEnabled schema-default values, which ClipCandidate
// itself doesn't carry.
export async function createCandidateClips(
  videoId: string,
  rawCandidates: ClipScoringCandidate[],
  segments: TranscriptSegment[],
  processingOptions: ProcessingOptions | null,
): Promise<{ clips: CreatedClip[]; candidates: ClipCandidate[] }> {
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
          emojiSuggestions: emojiSuggestionsFor(segments, candidate.startTime, candidate.endTime),
        },
      }),
    ),
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

  return { clips, candidates };
}

// Step 2 of 2: resolves this video's effective Brand Kit once, then enqueues
// one RENDER_CLIP job per candidate - unchanged from detect-clips.worker.ts's
// original inline block. Caller is responsible for only invoking this when
// candidates.length > 0 (same guard the original had).
export async function enqueueRendersForCandidates(
  videoId: string,
  clips: CreatedClip[],
  candidates: ClipCandidate[],
  processingOptions: ProcessingOptions | null,
): Promise<void> {
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
      renderClipQueue.add(
        QueueName.RENDER_CLIP,
        {
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
            clips[index].fontFamily ?? (clips[index].applyBrandKit ? brandKit.brandFontFamily : null),
          // Watermark roadmap (P3c) - clips[index].watermarkEnabled
          // is always true for a brand-new clip, same "always true,
          // written for precedence consistency anyway" reasoning as
          // fontFamily's own comment above.
          watermark: clips[index].watermarkEnabled ? ownerWatermark : null,
          // Intro roadmap (P3d) - same "always true for a
          // brand-new clip, Brand-Kit-driven in practice" reasoning
          // as watermark above.
          intro: clips[index].introEnabled ? ownerIntro : null,
          outro: clips[index].outroEnabled ? ownerOutro : null,
          keywords: candidate.keywords,
          scores: candidate.scores,
        },
        RENDER_CLIP_RETRY_OPTIONS,
      ),
    ),
  );
}
