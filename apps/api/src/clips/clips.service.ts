import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PublishStatus,
  recordAuditLog,
  WorkspaceRole,
  type CaptionStyle,
  type ClipVersion,
  type Prisma,
} from '@speedora/database';
import {
  ClipPlatformCopyStatus as SharedClipPlatformCopyStatus,
  filterSegmentsForClip,
  PUBLISH_RETRY_OPTIONS,
  QueueName,
  sanitizeHashtags,
  SocialPlatform,
  type ClipExplainabilityDto,
  type ClipPerformanceDto,
  type ClipPlatformCopyDto,
  type ClipPlatformCopyListDto,
  type ClipPlatformFitDto,
  type ClipVersionDto,
  type ClipVersionListDto,
  type GeneratePlatformCopyJobData,
  type PublishClipJobData,
  type PublishRecord,
  type RenderClipJobData,
  type ThumbnailFallbackLevel,
} from '@speedora/shared';
import { computePlatformFit } from '@speedora/platform-fit';
import type { Queue } from 'bullmq';
import type { ClipPlatformCopy } from '@speedora/database';
import { CampaignsService } from '../campaigns/campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringSchedulesService } from '../recurring-schedules/recurring-schedules.service';
import { toSharedPublishRecord } from '../social/publish-record.util';
import { SocialAccountsService } from '../social/social.service';
import { StorageService } from '../storage/storage.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import {
  toSharedActiveSpeakerSamples,
  toSharedAudioFeatures,
  toSharedCaptionStyle,
  toSharedClipScores,
  toSharedFaceLandmarkFeatures,
  toSharedFaceLandmarks,
  toSharedFacialEmotions,
  toSharedFacialFeatures,
  toSharedGestureFeatures,
  toSharedGestures,
  toSharedHighlightBreakdown,
  toSharedHighlightExplainability,
  toSharedHighlightPrediction,
  toSharedHighlightRecommendation,
  toSharedLlmFeatures,
  toSharedOcrFeatures,
  toSharedOcrText,
  toSharedCameraMotion,
  toSharedCameraMotionFeatures,
  toSharedCompositionFeatures,
  toSharedEditingRhythmFeatures,
  toSharedLipSyncVerifications,
  toSharedMotionEnergy,
  toSharedMotionEnergyFeatures,
  toSharedObjectFeatures,
  toSharedObjects,
  toSharedObjectTracks,
  toSharedOcrTracks,
  toSharedSceneCutEvents,
  toSharedSceneFeatures,
  toSharedSpeakerConfidenceScores,
  toSharedSpeakerEngagementScores,
  toSharedSpeakerFaceAssociations,
  toSharedSpeakerHighlightMoments,
  toSharedSpeakerImportanceScores,
  toSharedSpeakerTimeline,
  toSharedSpeakerTimelineFeatures,
  toSharedStoryboardFrameKeys,
  toSharedThumbnailSelectionBreakdown,
  toSharedTrackingQualityMetrics,
  toSharedTranscriptSegment,
} from '../videos/transcript-segment.util';
import { CLIP_WITH_PERFORMANCE, toClipPerformanceDto } from './clip-performance.util';
import type { PublishClipDto } from './dto/publish-clip.dto';
import type { UpdateClipDto } from './dto/update-clip.dto';

function toVersionDto(version: ClipVersion & { createdBy: { email: string } }): ClipVersionDto {
  return {
    id: version.id,
    clipId: version.clipId,
    versionNumber: version.versionNumber,
    startTime: version.startTime,
    endTime: version.endTime,
    downloadUrl: version.outputUrl
      ? `/clips/${version.clipId}/versions/${version.id}/download`
      : null,
    thumbnailUrl: version.thumbnailUrl
      ? `/clips/${version.clipId}/versions/${version.id}/thumbnail`
      : null,
    captionStyle: version.captionStyle as unknown as ClipVersionDto['captionStyle'],
    hookText: version.hookText,
    hashtags: version.hashtags,
    viralityScore: version.viralityScore,
    createdByEmail: version.createdBy.email,
    createdAt: version.createdAt.toISOString(),
  };
}

// Publishing Expansion Phase 7B (AI SEO) - the user's own explicit choice
// this pass: there's no other spend guardrail to reuse for a fully
// discretionary, per-click LLM call (ThrottlerModule only guards auth;
// PremiumCredit is a purchase-and-consume model, not a limiter).
const MAX_PLATFORM_COPY_GENERATIONS_PER_DAY = 5;
const PLATFORM_COPY_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Sprint 6I (AI Insight) - "bounded so this endpoint can never itself
// become a slow query" (same reasoning as AnalyticsService's own
// MAX_CANDIDATE_ROWS) - a median over this many samples is already far
// more than the +/-15% band needs to be meaningful.
const HISTORICAL_ENGAGEMENT_SAMPLE_BOUND = 500;

// Stabilization Pass (API Contract Audit) - listVersions/listPlatformCopies
// had no bound at all; this caps the pathological case (a clip re-rendered
// or copy-generated hundreds of times) without adding cursor pagination
// these two low-cardinality-in-practice lists don't otherwise need.
const MAX_UNBOUNDED_LIST_ROWS = 200;

function toSharedPlatformCopy(row: ClipPlatformCopy): ClipPlatformCopyDto {
  return {
    id: row.id,
    clipId: row.clipId,
    // Prisma's own SocialPlatform enum and @speedora/shared's are nominally
    // distinct TS enum types even though they share the same runtime string
    // values (same "narrow via a cast at the one call site that needs it"
    // convention used across this codebase, e.g. ExportService.toDto).
    platform: row.platform as unknown as SocialPlatform,
    status: row.status as unknown as SharedClipPlatformCopyStatus,
    caption: row.caption,
    hashtags: row.hashtags,
    description: row.description,
    failReason: row.failReason,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ClipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socialAccounts: SocialAccountsService,
    private readonly storage: StorageService,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly campaigns: CampaignsService,
    private readonly recurringSchedules: RecurringSchedulesService,
    @InjectQueue(QueueName.RENDER_CLIP) private readonly renderClipQueue: Queue<RenderClipJobData>,
    @InjectQueue(QueueName.PUBLISH_CLIP)
    private readonly publishClipQueue: Queue<PublishClipJobData>,
    @InjectQueue(QueueName.GENERATE_PLATFORM_COPY)
    private readonly generatePlatformCopyQueue: Queue<GeneratePlatformCopyJobData>,
  ) {}

  // Explicit return type (rather than inferred) - a Clip row now includes
  // the Json `scores` column (Fase 8), and an un-annotated inferred type
  // that includes a Json field can't be named without referencing Prisma's
  // internal runtime module, which breaks declaration emit (TS2742) for
  // every caller up the chain.
  private static readonly CLIP_WITH_VIDEO = { include: { video: true } } as const;

  // Same "not found" for a missing clip and someone with insufficient
  // workspace access, so a client can't use this endpoint to probe which
  // clip IDs exist. minRole defaults to VIEWER (every read-only call site
  // below relies on that default); mutating call sites (update/remove/
  // render/publish/reschedule) pass a higher minRole explicitly - see
  // WorkspaceAccessService for the rank table.
  async findOwnedOrThrow(
    id: string,
    requesterId: string,
    minRole: WorkspaceRole = WorkspaceRole.VIEWER,
  ): Promise<Prisma.ClipGetPayload<typeof ClipsService.CLIP_WITH_VIDEO>> {
    const clip = await this.prisma.clip.findUnique({
      where: { id },
      ...ClipsService.CLIP_WITH_VIDEO,
    });

    if (!clip) {
      throw new NotFoundException(`Clip ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, clip.video.workspaceId, minRole);
    return clip;
  }

  async findRenderedOrThrow(
    id: string,
    requesterId: string,
    minRole: WorkspaceRole = WorkspaceRole.VIEWER,
  ): Promise<Prisma.ClipGetPayload<typeof ClipsService.CLIP_WITH_VIDEO>> {
    const clip = await this.findOwnedOrThrow(id, requesterId, minRole);
    if (!clip.outputUrl) {
      throw new NotFoundException(`Clip ${id} has not finished rendering yet`);
    }
    return clip;
  }

  // Used by GET /clips/:id/thumbnail (Product Experience roadmap) - same
  // shape/reasoning as findRenderedOrThrow above, for the extracted
  // thumbnail frame instead of the rendered video.
  async findThumbnailOrThrow(id: string, requesterId: string): Promise<{ thumbnailUrl: string }> {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    if (!clip.thumbnailUrl) {
      throw new NotFoundException(`Clip ${id} has no thumbnail`);
    }
    return { thumbnailUrl: clip.thumbnailUrl };
  }

  // Used by GET /clips/:id/animated-thumbnail (Product Experience roadmap,
  // Phase 3) - same shape/reasoning as findThumbnailOrThrow above, for the
  // extracted looping preview instead of the static frame.
  async findAnimatedThumbnailOrThrow(
    id: string,
    requesterId: string,
  ): Promise<{ animatedThumbnailUrl: string }> {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    if (!clip.animatedThumbnailUrl) {
      throw new NotFoundException(`Clip ${id} has no animated thumbnail`);
    }
    return { animatedThumbnailUrl: clip.animatedThumbnailUrl };
  }

  // Used by GET /clips/:id/hover-preview (Product Experience roadmap,
  // Phase 3) - same shape/reasoning as findThumbnailOrThrow above, for the
  // longer/smoother preview fetched on-demand only on hover.
  async findHoverPreviewOrThrow(
    id: string,
    requesterId: string,
  ): Promise<{ hoverPreviewUrl: string }> {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    if (!clip.hoverPreviewUrl) {
      throw new NotFoundException(`Clip ${id} has no hover preview`);
    }
    return { hoverPreviewUrl: clip.hoverPreviewUrl };
  }

  // Used by GET /clips/:id/storyboard/:index (Product Experience roadmap,
  // Phase 3) - same shape/reasoning as findThumbnailOrThrow above,
  // parameterized by frame index.
  async findStoryboardFrameOrThrow(
    id: string,
    requesterId: string,
    index: number,
  ): Promise<{ frameKey: string }> {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    const frameKey = toSharedStoryboardFrameKeys(clip.storyboardFrameUrls)[index];
    if (!frameKey) {
      throw new NotFoundException(`Clip ${id} has no storyboard frame at index ${index}`);
    }
    return { frameKey };
  }

  // Milestone 4 (AI Explainability) - a focused read of just the Fusion
  // Engine fields, not the full toDto() shape (rendering/publish/caption
  // fields this page has no use for). `results` is an array so a future
  // milestone that wires a real v3 Predictor into the render pipeline can
  // add a second entry without changing this contract - today it's always
  // exactly one `engine: 'v2'` result. Fields are mapped explicitly (not
  // via an un-narrowed `...clip` spread) through the same toShared* helpers
  // toDto() already uses, so this carries no TS2742 risk.
  async getExplainability(id: string, requesterId: string): Promise<ClipExplainabilityDto> {
    const clip = await this.findOwnedOrThrow(id, requesterId);

    return {
      clipId: clip.id,
      results: [
        {
          engine: 'v2',
          highlightScore: clip.highlightScore,
          highlightConfidence: clip.highlightConfidence,
          highlightReason: clip.highlightReason,
          highlightBreakdown: toSharedHighlightBreakdown(clip.highlightBreakdown),
          highlightExplainability: toSharedHighlightExplainability(clip.highlightExplainability),
          highlightPrediction: toSharedHighlightPrediction(clip.highlightPrediction),
          highlightRecommendation: toSharedHighlightRecommendation(clip.highlightRecommendation),
          highlightRank: clip.highlightRank,
        },
      ],
    };
  }

  // Sprint 6C (Analytics Dashboard Expansion - Per-Clip Performance). One
  // query (CLIP_WITH_PERFORMANCE's nested `include`), not a loop that
  // queries per PublishRecord - see clip-performance.util.ts's own comment.
  // Deliberately NOT reusing findOwnedOrThrow here since that only includes
  // `video` - this needs the fuller publishRecords/statsSnapshots/campaign/
  // recurringSchedule graph in the same round trip, so the not-found/access
  // check is inlined against this richer fetch instead of calling
  // findOwnedOrThrow and then querying again.
  async getPerformance(id: string, requesterId: string): Promise<ClipPerformanceDto> {
    const clip = await this.prisma.clip.findUnique({
      where: { id },
      ...CLIP_WITH_PERFORMANCE,
    });

    if (!clip) {
      throw new NotFoundException(`Clip ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, clip.video.workspaceId, WorkspaceRole.VIEWER);

    // Sprint 6I/6J (AI Insight narrative + prediction) - a second,
    // deliberate query: both classifying this clip's outcome against its
    // owner's OTHER clips (6I) and projecting a prediction from their
    // (highlightScore, engagementScore) correlation (6J) need those other
    // clips' own highlightScore + latest stats, which can't be folded into
    // CLIP_WITH_PERFORMANCE's single-clip query above (a genuinely
    // different, cross-record concern, same as every other sprint's own
    // separate aggregate query - e.g. WorkspaceAnalyticsService's
    // getLeaderboard). One query serves both features rather than two.
    // Bounded the same way every other cross-record aggregate in this app
    // is.
    const historicalRecords = await this.prisma.publishRecord.findMany({
      where: {
        status: PublishStatus.PUBLISHED,
        clipId: { not: id },
        clip: { video: { ownerId: clip.video.ownerId } },
      },
      select: {
        statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
        clip: { select: { highlightScore: true } },
      },
      take: HISTORICAL_ENGAGEMENT_SAMPLE_BOUND,
    });

    return toClipPerformanceDto(
      clip,
      historicalRecords.map((r) => ({
        highlightScore: r.clip.highlightScore,
        engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
      })),
    );
  }

  // Publishing Expansion Phase 7A (AI SEO - Platform-Fit Recommendation).
  // Read-only, computed-on-request - same shape as getExplainability above,
  // but over Clip.scores (the frozen detect-clips LLM call's ClipScores
  // breakdown) rather than the Fusion Engine's highlight* columns. No
  // persistence, no LLM call - @speedora/platform-fit's computePlatformFit
  // is a pure weighted-sum. `rankings: []` when a clip has no scores yet
  // (pre-Fase-8 data, or an edge case), same graceful-null posture as
  // getExplainability's nullable highlight* fields.
  async getPlatformFit(id: string, requesterId: string): Promise<ClipPlatformFitDto> {
    const clip = await this.findOwnedOrThrow(id, requesterId);
    const scores = toSharedClipScores(clip.scores);

    return {
      clipId: clip.id,
      // @speedora/contracts' SocialPlatform is its own duplicated string
      // literal union (no dependency on @speedora/shared's real enum, same
      // convention as ClipScores) - safe to cast since both enumerate the
      // exact same 8 values, checked by clips.service.spec.ts.
      rankings: scores
        ? (computePlatformFit(scores).rankings as unknown as ClipPlatformFitDto['rankings'])
        : [],
    };
  }

  // Publishing Expansion Phase 7B (AI SEO) - creates a new ClipPlatformCopy
  // row (append-only, see the schema's own comment - never upserts an
  // existing row in place) and enqueues the LLM generation job, same
  // "create synchronously so the client can poll immediately, then
  // enqueue" shape as ExportService.create()/this.render(). A brand-new,
  // standalone LLM call - never reads/writes Clip.scores/viralityScore/
  // highlightScore or the frozen detect-clips prompt.
  async generatePlatformCopy(
    id: string,
    requesterId: string,
    platform: SocialPlatform,
  ): Promise<ClipPlatformCopyDto> {
    const clip = await this.findOwnedOrThrow(id, requesterId, WorkspaceRole.EDITOR);

    if (!clip.hookText) {
      throw new BadRequestException(
        'This clip has no AI-generated hook/topics yet - nothing to build SEO copy from.',
      );
    }

    const since = new Date(Date.now() - PLATFORM_COPY_RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.prisma.clipPlatformCopy.count({
      where: { clipId: id, platform, createdAt: { gte: since } },
    });
    if (recentCount >= MAX_PLATFORM_COPY_GENERATIONS_PER_DAY) {
      throw new BadRequestException(
        `Generate limit reached for this platform (${MAX_PLATFORM_COPY_GENERATIONS_PER_DAY}/24h) - try again later.`,
      );
    }

    const row = await this.prisma.clipPlatformCopy.create({
      data: { clipId: id, platform },
    });
    await this.generatePlatformCopyQueue.add(QueueName.GENERATE_PLATFORM_COPY, {
      clipPlatformCopyId: row.id,
    });

    return toSharedPlatformCopy(row);
  }

  async listPlatformCopies(id: string, requesterId: string): Promise<ClipPlatformCopyListDto> {
    await this.findOwnedOrThrow(id, requesterId);

    const rows = await this.prisma.clipPlatformCopy.findMany({
      where: { clipId: id },
      orderBy: { createdAt: 'desc' },
      take: MAX_UNBOUNDED_LIST_ROWS,
    });

    return { copies: rows.map(toSharedPlatformCopy) };
  }

  // Permanently deletes one clip (its publish records cascade via the
  // schema) and best-effort cleans up its rendered output in storage - not
  // the parent video or any sibling clip. Video.status is left untouched:
  // it only ever moves forward through the pipeline (see CLAUDE.md's state
  // machine) and is never recomputed from the current clip count, so
  // removing one clip here has no bearing on it.
  async remove(id: string, requesterId: string): Promise<void> {
    const clip = await this.findOwnedOrThrow(id, requesterId, WorkspaceRole.ADMIN);

    await this.prisma.clip.delete({ where: { id } });
    if (clip.outputUrl) {
      // Deliberately not awaited - deleteObjects is already best-effort (it
      // swallows storage errors), so keeping the HTTP response waiting on a
      // slow round-trip to object storage buys nothing except a laggy
      // delete button. The DB row (the source of truth) is already gone.
      void this.storage.deleteObjects([clip.outputUrl]);
    }

    // Sprint 5F (Audit Log) - best-effort, same posture as every other
    // recordAuditLog call site.
    await recordAuditLog(this.prisma, {
      workspaceId: clip.video.workspaceId,
      action: 'CLIP_DELETED',
      actorId: requesterId,
      targetType: 'Clip',
      targetId: id,
      metadata: { videoId: clip.videoId, hookText: clip.hookText },
    }).catch(() => {});
  }

  // Manual trim/style change from the timeline editor. Deliberately does not
  // touch outputUrl or enqueue a render - re-rendering is a separate
  // explicit action (see render() below) so dragging a trim handle or
  // switching caption presets doesn't burn FFmpeg compute on every
  // intermediate value.
  async update(id: string, requesterId: string, input: UpdateClipDto) {
    const clip = await this.findOwnedOrThrow(id, requesterId, WorkspaceRole.EDITOR);
    const startTime = input.startTime ?? clip.startTime;
    const endTime = input.endTime ?? clip.endTime;
    const captionStyle = input.captionStyle ?? clip.captionStyle;
    const hookText = input.hookText ?? clip.hookText;
    const hashtags = input.hashtags ? sanitizeHashtags(input.hashtags) : clip.hashtags;

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const updated = await this.prisma.clip.update({
      where: { id },
      data: { startTime, endTime, captionStyle, hookText, hashtags },
      include: { publishRecords: { include: { socialAccount: true } } },
    });

    return this.toDto(updated);
  }

  // Re-renders a single clip with its current startTime/endTime (reuses the
  // same render-clip job/worker as the initial auto-detected render - its
  // logic is already generic over start/end and overwrites the same
  // renders/<clipId>.mp4 key, so nothing there needs to know this is a
  // "re-render" rather than the first one).
  async render(id: string, requesterId: string) {
    const clip = await this.findOwnedOrThrow(id, requesterId, WorkspaceRole.EDITOR);

    const segments = await this.prisma.transcriptSegment.findMany({
      where: { videoId: clip.videoId },
    });

    // Sprint 5E (Version Compare & History) + cleared-before-enqueueing, in
    // one transaction: the pre-render state is snapshotted into ClipVersion
    // (see that model's own comment) right before it's overwritten, so
    // nothing between the snapshot and the clear can be lost to a race.
    // Clearing (not left stale) keeps two things true while the re-render
    // is in flight: apps/web's existing "Rendering..." fallback (shown
    // whenever a clip's downloadUrl is null) kicks in for free, and if
    // this render-clip job fails, VideosService.retry's "clips without
    // outputUrl need render-clip" check finds this clip again instead of
    // thinking it's still fine. Also bumps updatedAt, which apps/web polls
    // to detect when the re-render finishes.
    const cleared = await this.prisma.$transaction(async (tx) => {
      const versionCount = await tx.clipVersion.count({ where: { clipId: id } });
      await tx.clipVersion.create({
        data: {
          clipId: id,
          versionNumber: versionCount + 1,
          startTime: clip.startTime,
          endTime: clip.endTime,
          outputUrl: clip.outputUrl,
          outputSizeBytes: clip.outputSizeBytes,
          thumbnailUrl: clip.thumbnailUrl,
          captionStyle: clip.captionStyle,
          hookText: clip.hookText,
          hashtags: clip.hashtags,
          viralityScore: clip.viralityScore,
          createdById: requesterId,
        },
      });

      return tx.clip.update({
        where: { id },
        data: { outputUrl: null },
        include: { publishRecords: { include: { socialAccount: true } } },
      });
    });

    await this.renderClipQueue.add(QueueName.RENDER_CLIP, {
      clipId: clip.id,
      videoId: clip.videoId,
      sourceUrl: clip.video.sourceUrl,
      startTime: clip.startTime,
      endTime: clip.endTime,
      transcript: filterSegmentsForClip(
        segments.map(toSharedTranscriptSegment),
        clip.startTime,
        clip.endTime,
      ),
      captionStyle: toSharedCaptionStyle(clip.captionStyle),
      keywords: clip.keywords,
      scores: toSharedClipScores(clip.scores),
    });

    return this.toDto(cleared);
  }

  async listVersions(userId: string, clipId: string): Promise<ClipVersionListDto> {
    await this.findOwnedOrThrow(clipId, userId, WorkspaceRole.VIEWER);
    const versions = await this.prisma.clipVersion.findMany({
      where: { clipId },
      orderBy: { versionNumber: 'desc' },
      include: { createdBy: { select: { email: true } } },
      take: MAX_UNBOUNDED_LIST_ROWS,
    });
    return { versions: versions.map(toVersionDto) };
  }

  // Metadata-only - copies a past version's trim/caption/hook/hashtags back
  // onto the live Clip row, but deliberately does NOT touch outputUrl: the
  // old rendered bytes aren't guaranteed to still exist in storage (and
  // even if they do, they're stale the instant startTime/endTime differ
  // from what's live). The caller re-renders separately (a normal render()
  // call) once they're happy with the restored settings, same two-step
  // "edit, then explicitly re-render" flow ClipsService.update() already
  // has for any other metadata change.
  async restoreVersion(userId: string, clipId: string, versionId: string) {
    await this.findOwnedOrThrow(clipId, userId, WorkspaceRole.EDITOR);
    const version = await this.findVersionOrThrow(clipId, versionId);

    const updated = await this.prisma.clip.update({
      where: { id: clipId },
      data: {
        startTime: version.startTime,
        endTime: version.endTime,
        captionStyle: version.captionStyle,
        hookText: version.hookText,
        hashtags: version.hashtags,
      },
      include: { publishRecords: { include: { socialAccount: true } } },
    });

    return this.toDto(updated);
  }

  async getVersionOutputOrThrow(
    userId: string,
    clipId: string,
    versionId: string,
  ): Promise<{ outputUrl: string }> {
    await this.findOwnedOrThrow(clipId, userId, WorkspaceRole.VIEWER);
    const version = await this.findVersionOrThrow(clipId, versionId);
    if (!version.outputUrl) {
      throw new NotFoundException(`Version ${versionId} has no rendered output`);
    }
    return { outputUrl: version.outputUrl };
  }

  async getVersionThumbnailOrThrow(
    userId: string,
    clipId: string,
    versionId: string,
  ): Promise<{ thumbnailUrl: string }> {
    await this.findOwnedOrThrow(clipId, userId, WorkspaceRole.VIEWER);
    const version = await this.findVersionOrThrow(clipId, versionId);
    if (!version.thumbnailUrl) {
      throw new NotFoundException(`Version ${versionId} has no thumbnail`);
    }
    return { thumbnailUrl: version.thumbnailUrl };
  }

  private async findVersionOrThrow(clipId: string, versionId: string): Promise<ClipVersion> {
    const version = await this.prisma.clipVersion.findUnique({ where: { id: versionId } });
    if (!version || version.clipId !== clipId) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }
    return version;
  }

  // Manual "publish now" (Fase 6b), or a scheduled future publish (Fase 6c)
  // when input.scheduledAt is set - either way creates the PublishRecord row
  // synchronously (so it exists immediately for the UI to show/poll, same
  // reasoning as render()'s eager outputUrl clear). Purely additive to the
  // clip - unlike render(), does not touch/clear anything on the Clip row
  // itself. A scheduled record is NOT enqueued here - it starts at
  // SCHEDULED and apps/worker's schedule-publish-clip poller enqueues it
  // (moving it to QUEUED) once scheduledAt arrives.
  async publish(id: string, requesterId: string, input: PublishClipDto) {
    const clip = await this.findRenderedOrThrow(id, requesterId, WorkspaceRole.EDITOR);
    // Throws NotFoundException if the account doesn't exist or belongs to
    // someone else - same ownership check pattern as findOwnedOrThrow.
    await this.socialAccounts.findOwnedOrThrow(input.socialAccountId, requesterId);

    if (input.campaignId) {
      await this.campaigns.assertUsableForQueue(clip.video.workspaceId, input.campaignId);
    }

    // Publishing Expansion Phase 6 (Scheduling) - a recurring-schedule
    // queue REPLACES the normal scheduledAt handling below: the server is
    // authoritative on when the job actually fires (next-slot.util.ts),
    // not whatever (if anything) the client sent.
    let scheduledAt: Date | null;
    if (input.recurringScheduleId) {
      scheduledAt = await this.recurringSchedules.resolveSlotForQueue(
        clip.video.workspaceId,
        input.recurringScheduleId,
        input.socialAccountId,
      );
    } else {
      scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestException('scheduledAt must be in the future');
      }
    }

    const record = await this.prisma.publishRecord.create({
      data: {
        clipId: clip.id,
        socialAccountId: input.socialAccountId,
        status: scheduledAt ? PublishStatus.SCHEDULED : PublishStatus.QUEUED,
        scheduledAt,
        campaignId: input.campaignId ?? null,
        recurringScheduleId: input.recurringScheduleId ?? null,
      },
      include: { socialAccount: true },
    });

    if (!scheduledAt) {
      await this.publishClipQueue.add(
        QueueName.PUBLISH_CLIP,
        { publishRecordId: record.id },
        PUBLISH_RETRY_OPTIONS,
      );
    }

    return toSharedPublishRecord(record);
  }

  // Cancel a publish that hasn't fired yet (Fase 6c). Scoped to id+clipId+
  // SCHEDULED in one atomic deleteMany - a record that's already QUEUED/
  // PUBLISHING/PUBLISHED/FAILED has either already been handed to the
  // worker or finished, and canceling it here wouldn't stop/undo an
  // in-flight or completed upload, so it's deliberately not cancellable
  // past SCHEDULED.
  async cancelScheduledPublish(id: string, recordId: string, requesterId: string): Promise<void> {
    await this.findOwnedOrThrow(id, requesterId, WorkspaceRole.EDITOR);

    const { count } = await this.prisma.publishRecord.deleteMany({
      where: { id: recordId, clipId: id, status: PublishStatus.SCHEDULED },
    });
    if (count === 0) {
      throw new NotFoundException(`Scheduled publish ${recordId} not found`);
    }
  }

  // Reschedule a publish that hasn't fired yet (Fase 6c) to a new future
  // time. Same SCHEDULED-only scoping as cancelScheduledPublish, for the
  // same reason - once claimed by the poller it's no longer just a plan,
  // it's an in-flight (or finished) job.
  async reschedulePublish(
    id: string,
    recordId: string,
    requesterId: string,
    newScheduledAt: string,
  ) {
    await this.findOwnedOrThrow(id, requesterId, WorkspaceRole.EDITOR);

    const parsed = new Date(newScheduledAt);
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    const { count } = await this.prisma.publishRecord.updateMany({
      where: { id: recordId, clipId: id, status: PublishStatus.SCHEDULED },
      data: { scheduledAt: parsed },
    });
    if (count === 0) {
      throw new NotFoundException(`Scheduled publish ${recordId} not found`);
    }

    const record = await this.prisma.publishRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: { socialAccount: true },
    });
    return toSharedPublishRecord(record);
  }

  private toDto(clip: {
    id: string;
    videoId: string;
    startTime: number;
    endTime: number;
    viralityScore: number;
    outputUrl: string | null;
    thumbnailUrl: string | null;
    thumbnailBlurDataUrl: string | null;
    animatedThumbnailUrl: string | null;
    hoverPreviewUrl: string | null;
    storyboardFrameUrls: unknown;
    captionStyle: CaptionStyle;
    hookText: string | null;
    hashtags: string[];
    scores: unknown;
    reason: string | null;
    topics: string[];
    keywords: string[];
    intent: string | null;
    ctaText: string | null;
    emojiSuggestions: string[];
    facialEmotions: unknown;
    sceneCutEvents: unknown;
    motionEnergy: unknown;
    motionEnergyFeatures: unknown;
    cameraMotion: unknown;
    cameraMotionFeatures: unknown;
    editingRhythmFeatures: unknown;
    gestures: unknown;
    audioFeatures: unknown;
    sceneFeatures: unknown;
    facialFeatures: unknown;
    gestureFeatures: unknown;
    faceLandmarks: unknown;
    faceLandmarkFeatures: unknown;
    trackingQualityMetrics: unknown;
    activeSpeakerSamples: unknown;
    speakerFaceAssociations: unknown;
    lipSyncVerifications: unknown;
    speakerTimeline: unknown;
    speakerTimelineFeatures: unknown;
    speakerConfidenceScores: unknown;
    speakerEngagementScores: unknown;
    speakerImportanceScores: unknown;
    speakerHighlightMoments: unknown;
    ocrText: unknown;
    ocrTracks: unknown;
    ocrFeatures: unknown;
    objects: unknown;
    objectTracks: unknown;
    objectFeatures: unknown;
    highlightScore: number | null;
    highlightBreakdown: unknown;
    highlightExplainability: unknown;
    highlightConfidence: number | null;
    highlightReason: string | null;
    llmFeatures: unknown;
    highlightPrediction: unknown;
    highlightRecommendation: unknown;
    highlightRank: number | null;
    compositionFeatures: unknown;
    thumbnailSelectionTimestamp: number | null;
    thumbnailSelectionBreakdown: unknown;
    thumbnailSelectionFallback: string | null;
    thumbnailSelectionReason: string | null;
    publishRecords: Parameters<typeof toSharedPublishRecord>[0][];
    updatedAt: Date;
  }) {
    return {
      id: clip.id,
      videoId: clip.videoId,
      startTime: clip.startTime,
      endTime: clip.endTime,
      viralityScore: clip.viralityScore,
      downloadUrl: clip.outputUrl ? `/clips/${clip.id}/download` : null,
      thumbnailUrl: clip.thumbnailUrl ? `/clips/${clip.id}/thumbnail` : null,
      thumbnailBlurDataUrl: clip.thumbnailBlurDataUrl,
      animatedThumbnailUrl: clip.animatedThumbnailUrl
        ? `/clips/${clip.id}/animated-thumbnail`
        : null,
      hoverPreviewUrl: clip.hoverPreviewUrl ? `/clips/${clip.id}/hover-preview` : null,
      storyboardFrameUrls: toSharedStoryboardFrameKeys(clip.storyboardFrameUrls).map(
        (_, i) => `/clips/${clip.id}/storyboard/${i}`,
      ),
      captionStyle: clip.captionStyle,
      hookText: clip.hookText,
      hashtags: clip.hashtags,
      scores: toSharedClipScores(clip.scores),
      reason: clip.reason,
      topics: clip.topics,
      keywords: clip.keywords,
      intent: clip.intent,
      ctaText: clip.ctaText,
      emojiSuggestions: clip.emojiSuggestions,
      facialEmotions: toSharedFacialEmotions(clip.facialEmotions),
      sceneCutEvents: toSharedSceneCutEvents(clip.sceneCutEvents),
      gestures: toSharedGestures(clip.gestures),
      audioFeatures: toSharedAudioFeatures(clip.audioFeatures),
      sceneFeatures: toSharedSceneFeatures(clip.sceneFeatures),
      motionEnergy: toSharedMotionEnergy(clip.motionEnergy),
      motionEnergyFeatures: toSharedMotionEnergyFeatures(clip.motionEnergyFeatures),
      cameraMotion: toSharedCameraMotion(clip.cameraMotion),
      cameraMotionFeatures: toSharedCameraMotionFeatures(clip.cameraMotionFeatures),
      editingRhythmFeatures: toSharedEditingRhythmFeatures(clip.editingRhythmFeatures),
      facialFeatures: toSharedFacialFeatures(clip.facialFeatures),
      gestureFeatures: toSharedGestureFeatures(clip.gestureFeatures),
      faceLandmarks: toSharedFaceLandmarks(clip.faceLandmarks),
      faceLandmarkFeatures: toSharedFaceLandmarkFeatures(clip.faceLandmarkFeatures),
      trackingQualityMetrics: toSharedTrackingQualityMetrics(clip.trackingQualityMetrics),
      activeSpeakerSamples: toSharedActiveSpeakerSamples(clip.activeSpeakerSamples),
      speakerFaceAssociations: toSharedSpeakerFaceAssociations(clip.speakerFaceAssociations),
      lipSyncVerifications: toSharedLipSyncVerifications(clip.lipSyncVerifications),
      speakerTimeline: toSharedSpeakerTimeline(clip.speakerTimeline),
      speakerTimelineFeatures: toSharedSpeakerTimelineFeatures(clip.speakerTimelineFeatures),
      speakerConfidenceScores: toSharedSpeakerConfidenceScores(clip.speakerConfidenceScores),
      speakerEngagementScores: toSharedSpeakerEngagementScores(clip.speakerEngagementScores),
      speakerImportanceScores: toSharedSpeakerImportanceScores(clip.speakerImportanceScores),
      speakerHighlightMoments: toSharedSpeakerHighlightMoments(clip.speakerHighlightMoments),
      ocrText: toSharedOcrText(clip.ocrText),
      ocrTracks: toSharedOcrTracks(clip.ocrTracks),
      ocrFeatures: toSharedOcrFeatures(clip.ocrFeatures),
      objects: toSharedObjects(clip.objects),
      objectTracks: toSharedObjectTracks(clip.objectTracks),
      objectFeatures: toSharedObjectFeatures(clip.objectFeatures),
      highlightScore: clip.highlightScore,
      highlightBreakdown: toSharedHighlightBreakdown(clip.highlightBreakdown),
      highlightExplainability: toSharedHighlightExplainability(clip.highlightExplainability),
      highlightConfidence: clip.highlightConfidence,
      highlightReason: clip.highlightReason,
      llmFeatures: toSharedLlmFeatures(clip.llmFeatures),
      highlightPrediction: toSharedHighlightPrediction(clip.highlightPrediction),
      highlightRecommendation: toSharedHighlightRecommendation(clip.highlightRecommendation),
      highlightRank: clip.highlightRank,
      compositionFeatures: toSharedCompositionFeatures(clip.compositionFeatures),
      thumbnailSelectionTimestamp: clip.thumbnailSelectionTimestamp,
      thumbnailSelectionBreakdown: toSharedThumbnailSelectionBreakdown(
        clip.thumbnailSelectionBreakdown,
      ),
      thumbnailSelectionFallback: clip.thumbnailSelectionFallback as ThumbnailFallbackLevel | null,
      thumbnailSelectionReason: clip.thumbnailSelectionReason,
      publishRecords: clip.publishRecords.map(toSharedPublishRecord) satisfies PublishRecord[],
      updatedAt: clip.updatedAt,
    };
  }
}
