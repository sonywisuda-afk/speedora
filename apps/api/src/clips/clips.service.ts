import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PublishStatus,
  type ClipPlatformCopyStatus as PrismaClipPlatformCopyStatus,
  recordAuditLog,
  WorkspaceRole,
  type CaptionStyle,
  type ClipVersion,
  type Prisma,
  // Aliased - this file already imports @speedora/shared's own SocialPlatform
  // below (used by toSharedPlatformCopy), same two-source-of-truth situation
  // AnalyticsService/AnalyticsController resolve the same way.
  type SocialPlatform as PrismaSocialPlatform,
} from '@speedora/database';
import {
  ClipPlatformCopyStatus as SharedClipPlatformCopyStatus,
  filterSegmentsForClip,
  mergeBrandKitFields,
  PUBLISH_RETRY_OPTIONS,
  QueueName,
  RENDER_CLIP_RETRY_OPTIONS,
  sanitizeHashtags,
  SocialPlatform,
  type BrandKitFields,
  type ClipExplainabilityDto,
  type ClipIntelligenceDto,
  type ClipPerformanceDto,
  type ClipPlatformCopyDto,
  type ClipPlatformCopyListDto,
  type ClipPlatformFitDto,
  type ClipVersionDto,
  type ClipVersionListDto,
  type GeneratePlatformCopyJobData,
  type IntroType,
  type PublishClipJobData,
  type PublishRecord,
  type RenderClipJobData,
  type ThumbnailFallbackLevel,
  type WatermarkPosition,
} from '@speedora/shared';
import { isHookPredictionEnabled } from '@speedora/hook-prediction';
import { isSemanticEventDetectionEnabled } from '@speedora/semantic-events';
import { isNarrativeGraphEnabled } from '@speedora/narrative-graph';
import { isContextualMomentumEnabled } from '@speedora/contextual-momentum';
import { isEmotionalArcEnabled } from '@speedora/emotional-arc';
import { isMultiSpeakerReasoningEnabled } from '@speedora/multi-speaker-reasoning';
import { isViralityEngineEnabled } from '@speedora/virality-engine';
import { isRetentionCurveInsightsEnabled } from '@speedora/retention-curve-insights';
import { isMultimodalReasoningEnabled } from '@speedora/multimodal-reasoning';
import { isSubtitleRewriteEnabled } from '@speedora/subtitle-rewriter';
import { isDynamicCaptionEnabled } from '@speedora/dynamic-caption';
import { computePlatformFit } from '@speedora/platform-fit';
import type { Queue } from 'bullmq';
import type { ClipPlatformCopy } from '@speedora/database';
import { CampaignsService } from '../campaigns/campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringSchedulesService } from '../recurring-schedules/recurring-schedules.service';
import { mapSocialPlatform, toSharedPublishRecord } from '../social/publish-record.util';
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
  toSharedHookPrediction,
  toSharedSemanticEvents,
  toSharedNarrativeGraph,
  toSharedContextualMomentum,
  toSharedEmotionalArc,
  toSharedMultiSpeakerBreakdown,
  toSharedViralityPrediction,
  toSharedRetentionCurveInsights,
  toSharedMultimodalReasoning,
  toSharedSubtitleIntelligence,
  toSharedCaptionTreatment,
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
    captionStyle: toSharedCaptionStyle(version.captionStyle),
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

// Watermark roadmap (P3c) - code-level defaults applied when a Brand Kit
// has a watermark image but hasn't set (or has cleared) one of these
// control fields - same "null means use the sensible default" posture
// brandFontFamily uses. Not stored in the DB as the column default so a
// user can tell "never touched this" apart from "explicitly chose these
// exact values" if that distinction ever matters later.
const DEFAULT_WATERMARK_OPACITY = 0.8;
const DEFAULT_WATERMARK_SCALE = 0.15;
const DEFAULT_WATERMARK_MARGIN = 0.03;
const DEFAULT_WATERMARK_POSITION: WatermarkPosition = 'BOTTOM_RIGHT';

// Workspace-level Brand Kit roadmap (P3g) - the same 15-field select shape
// BrandKitService's own BRAND_KIT_SELECT uses, inlined here rather than
// imported (each service resolves its own Brand Kit reads independently -
// an established convention in this codebase, see resolveFontFamily's own
// comment below).
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

function assertNeverClipPlatformCopyStatus(value: never): never {
  throw new Error(`Unhandled ClipPlatformCopyStatus: ${JSON.stringify(value)}`);
}

// Prisma's ClipPlatformCopyStatus and packages/shared's are nominally
// distinct TS enum types even though they share the same runtime string
// values (same "Mirrors X" convention used throughout this project). The
// switch has no `default` case, so a new schema.prisma member fails to
// compile here until a matching case (and packages/shared member) is added -
// same Contract Synchronization pattern as dashboard.service.ts's
// mapActivityEventType, replacing what used to be a blind `as unknown as`
// cast.
export function mapClipPlatformCopyStatus(
  status: PrismaClipPlatformCopyStatus,
): SharedClipPlatformCopyStatus {
  switch (status) {
    case 'PENDING':
      return SharedClipPlatformCopyStatus.PENDING;
    case 'PROCESSING':
      return SharedClipPlatformCopyStatus.PROCESSING;
    case 'READY':
      return SharedClipPlatformCopyStatus.READY;
    case 'FAILED':
      return SharedClipPlatformCopyStatus.FAILED;
    default:
      return assertNeverClipPlatformCopyStatus(status);
  }
}

function toSharedPlatformCopy(row: ClipPlatformCopy): ClipPlatformCopyDto {
  return {
    id: row.id,
    clipId: row.clipId,
    platform: mapSocialPlatform(row.platform),
    status: mapClipPlatformCopyStatus(row.status),
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

  // AI Clip Library roadmap (P1) - the first cross-video, filterable clip
  // listing this app has ever had (until now, clips were only ever nested
  // under one Video via VideosService.findAll/findOne). Cursor-paginated
  // exactly like VideosService.findAll, and workspace-role-scoped via
  // workspaceAccess the same way - deliberately NOT SearchService's looser
  // owner-only scoping, so this stays consistent with every other clip/video
  // read in this service. The dynamic `where` follows
  // AnalyticsService.fetchPublishedRecords' `...(filter.x ? { x } : {})`
  // idiom throughout.
  async findAllFiltered(
    requesterId: string,
    {
      cursor,
      limit,
      workspaceId,
      projectId,
      folderId,
      minScore,
      platform,
      minDuration,
      maxDuration,
      topics,
      emotion,
      keyword,
    }: {
      cursor?: string;
      limit: number;
      workspaceId?: string;
      projectId?: string;
      folderId?: string;
      minScore?: number;
      platform?: PrismaSocialPlatform;
      minDuration?: number;
      maxDuration?: number;
      topics?: string[];
      emotion?: string;
      keyword?: string;
    },
  ) {
    const targetWorkspaceId = await this.resolveTargetWorkspaceId(requesterId, {
      workspaceId,
      projectId,
    });

    const clips = await this.prisma.clip.findMany({
      where: {
        video: {
          workspaceId: targetWorkspaceId,
          ...(projectId ? { projectId } : {}),
          ...(folderId ? { folderId } : {}),
        },
        ...(minScore != null ? { viralityScore: { gte: minScore } } : {}),
        ...(platform ? { publishRecords: { some: { socialAccount: { platform } } } } : {}),
        ...(minDuration != null || maxDuration != null
          ? {
              durationSeconds: {
                ...(minDuration != null ? { gte: minDuration } : {}),
                ...(maxDuration != null ? { lte: maxDuration } : {}),
              },
            }
          : {}),
        ...(topics && topics.length > 0 ? { topics: { hasSome: topics } } : {}),
        // facialFeatures.dominantEmotion is the one existing per-clip
        // emotion AGGREGATE (see schema.prisma's facialFeatures comment) -
        // Postgres JSON path filtering, the first use of it in this
        // codebase (every other Json column here is only ever read back in
        // full, never filtered on).
        ...(emotion ? { facialFeatures: { path: ['dominantEmotion'], equals: emotion } } : {}),
        ...(keyword
          ? {
              OR: [
                { hookText: { contains: keyword, mode: 'insensitive' } },
                { hashtags: { has: keyword } },
                { topics: { has: keyword } },
                { keywords: { has: keyword } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { publishRecords: { include: { socialAccount: true } } },
    });

    const hasMore = clips.length > limit;
    const page = hasMore ? clips.slice(0, limit) : clips;

    return {
      clips: page.map((clip) => this.toDto(clip)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // GET /clips/facets - topics/keywords are free-text LLM output with no
  // fixed taxonomy (see schema.prisma's Clip.topics comment), so the filter
  // bar needs real, workspace-scoped option values rather than a hardcoded
  // list. unnest() + GROUP BY needs a raw query - Prisma's query builder has
  // no array-unnesting `where`/aggregate support.
  async getTopicFacets(
    requesterId: string,
    { workspaceId, projectId }: { workspaceId?: string; projectId?: string },
  ) {
    const targetWorkspaceId = await this.resolveTargetWorkspaceId(requesterId, {
      workspaceId,
      projectId,
    });

    const rows = await this.prisma.$queryRaw<{ topic: string; count: bigint }[]>`
      SELECT topic, COUNT(*)::bigint AS count
      FROM "Clip" c
      JOIN "Video" v ON v."id" = c."videoId"
      CROSS JOIN LATERAL unnest(c."topics") AS topic
      WHERE v."workspaceId" = ${targetWorkspaceId}
      GROUP BY topic
      ORDER BY count DESC
      LIMIT 30
    `;

    return { topics: rows.map((row) => ({ value: row.topic, count: Number(row.count) })) };
  }

  // Shared by findAllFiltered/getTopicFacets - same workspace/project
  // resolution VideosService.findAll performs (project wins if given,
  // otherwise explicit workspaceId, otherwise the requester's personal
  // workspace).
  private async resolveTargetWorkspaceId(
    requesterId: string,
    { workspaceId, projectId }: { workspaceId?: string; projectId?: string },
  ): Promise<string> {
    if (projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }
      await this.workspaceAccess.assertMinRole(
        requesterId,
        project.workspaceId,
        WorkspaceRole.VIEWER,
      );
      return project.workspaceId;
    }
    if (workspaceId) {
      await this.workspaceAccess.assertMinRole(requesterId, workspaceId, WorkspaceRole.VIEWER);
      return workspaceId;
    }
    return this.workspaceAccess.getPersonalWorkspaceId(requesterId);
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

  // AI Intelligence v4, Phase 1/2 (see docs/ai/intelligence-v4.md, ADR D9) -
  // a separate endpoint from getExplainability above, not a second
  // `results` entry there (see ClipIntelligenceDto's own doc comment for
  // why). Same ownership-check pattern as getExplainability. Each v4
  // field has its OWN independent flag gating its exposure, not
  // computation (ADR D8) - the render-graph nodes always run and their
  // Clip.* columns are always persisted when they succeed, so flipping
  // either flag on later needs no backfill.
  async getIntelligence(id: string, requesterId: string): Promise<ClipIntelligenceDto> {
    const clip = await this.findOwnedOrThrow(id, requesterId);

    return {
      clipId: clip.id,
      hookPrediction: isHookPredictionEnabled()
        ? toSharedHookPrediction(clip.hookPrediction)
        : null,
      semanticEvents: isSemanticEventDetectionEnabled()
        ? toSharedSemanticEvents(clip.semanticEvents)
        : null,
      narrativeGraph: isNarrativeGraphEnabled()
        ? toSharedNarrativeGraph(clip.narrativeGraph)
        : null,
      contextualMomentum: isContextualMomentumEnabled()
        ? toSharedContextualMomentum(clip.contextualMomentum)
        : null,
      emotionalArc: isEmotionalArcEnabled() ? toSharedEmotionalArc(clip.emotionalArc) : null,
      multiSpeakerBreakdown: isMultiSpeakerReasoningEnabled()
        ? toSharedMultiSpeakerBreakdown(clip.multiSpeakerBreakdown)
        : null,
      viralityPrediction: isViralityEngineEnabled()
        ? toSharedViralityPrediction(clip.viralityPrediction)
        : null,
      retentionCurveInsights: isRetentionCurveInsightsEnabled()
        ? toSharedRetentionCurveInsights(clip.retentionCurveInsights)
        : null,
      multimodalReasoning: isMultimodalReasoningEnabled()
        ? toSharedMultimodalReasoning(clip.multimodalReasoning)
        : null,
      subtitleIntelligence: isSubtitleRewriteEnabled()
        ? toSharedSubtitleIntelligence(clip.subtitleIntelligence)
        : null,
      captionTreatment: isDynamicCaptionEnabled()
        ? toSharedCaptionTreatment(clip.captionTreatment)
        : null,
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
    await this.workspaceAccess.assertMinRole(
      requesterId,
      clip.video.workspaceId,
      WorkspaceRole.VIEWER,
    );

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
    const speakerColorCaptions = input.speakerColorCaptions ?? clip.speakerColorCaptions;
    const smartSegmentation = input.smartSegmentation ?? clip.smartSegmentation;
    const dynamicCaptions = input.dynamicCaptions ?? clip.dynamicCaptions;
    const applyBrandKit = input.applyBrandKit ?? clip.applyBrandKit;
    const watermarkEnabled = input.watermarkEnabled ?? clip.watermarkEnabled;
    const introEnabled = input.introEnabled ?? clip.introEnabled;
    const outroEnabled = input.outroEnabled ?? clip.outroEnabled;
    const hookText = input.hookText ?? clip.hookText;
    const hashtags = input.hashtags ? sanitizeHashtags(input.hashtags) : clip.hashtags;

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const updated = await this.prisma.clip.update({
      where: { id },
      data: {
        startTime,
        endTime,
        durationSeconds: endTime - startTime,
        captionStyle,
        speakerColorCaptions,
        smartSegmentation,
        dynamicCaptions,
        applyBrandKit,
        watermarkEnabled,
        introEnabled,
        outroEnabled,
        // Explicit undefined check (not ??) - null is a real, distinct
        // value here (clears back to the original/untranslated text), same
        // "omitted vs. explicitly null" distinction MoveVideoDto's own
        // comment documents for projectId/folderId.
        ...(input.captionLanguage !== undefined ? { captionLanguage: input.captionLanguage } : {}),
        // Subtitle Presets roadmap (P3b) - same explicit-undefined-check
        // reasoning as captionLanguage above - null clears the per-clip
        // override back to Brand Kit resolution.
        ...(input.fontFamily !== undefined ? { fontFamily: input.fontFamily } : {}),
        hookText,
        hashtags,
      },
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

    // Workspace-level Brand Kit roadmap (P3g) - one merged-kit fetch shared
    // by all 4 resolve* calls below (was 1 owner-only fetch each before
    // P3g) - skipped entirely when nothing needs it, same "don't fetch when
    // not needed" posture this file's resolve* methods already had
    // individually.
    const needsBrandKit =
      (!clip.fontFamily && clip.applyBrandKit) ||
      clip.watermarkEnabled ||
      clip.introEnabled ||
      clip.outroEnabled;
    const brandKit = needsBrandKit
      ? await this.resolveEffectiveBrandKit(clip.video.workspaceId, clip.video.ownerId)
      : null;

    // brandKit === null here only ever means either clip.fontFamily was
    // already truthy (returned as-is) or applyBrandKit was falsy (the only
    // way needsBrandKit's first disjunct is false) - `?? null` normalizes
    // that second case the same way resolveFontFamily's own `!applyBrandKit
    // -> return null` branch would.
    const fontFamily = brandKit
      ? this.resolveFontFamily(brandKit, clip.applyBrandKit, clip.fontFamily)
      : (clip.fontFamily ?? null);
    const watermark = brandKit ? this.resolveWatermark(brandKit, clip.watermarkEnabled) : null;
    const intro = brandKit ? this.resolveIntro(brandKit, clip.introEnabled) : null;
    const outro = brandKit ? this.resolveOutro(brandKit, clip.outroEnabled) : null;

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

    await this.renderClipQueue.add(
      QueueName.RENDER_CLIP,
      {
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
        speakerColorCaptions: clip.speakerColorCaptions,
        smartSegmentation: clip.smartSegmentation,
        dynamicCaptions: clip.dynamicCaptions,
        captionLanguage: clip.captionLanguage,
        fontFamily,
        watermark,
        intro,
        outro,
        keywords: clip.keywords,
        scores: toSharedClipScores(clip.scores),
      },
      RENDER_CLIP_RETRY_OPTIONS,
    );

    return this.toDto(cleared);
  }

  // Workspace-level Brand Kit roadmap (P3g) - the merged effective Brand
  // Kit for a render: the video's workspace fields win per-field where set,
  // falling back to the video owner's personal (User) fields otherwise (see
  // mergeBrandKitFields's own comment) - skipped/no-op (workspace: null)
  // when the workspace IS the owner's personal one, since a personal
  // workspace's Brand Kit has always simply been the User row.
  private async resolveEffectiveBrandKit(
    workspaceId: string,
    ownerId: string,
  ): Promise<BrandKitFields> {
    const [workspace, owner] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { isPersonal: true, ...BRAND_KIT_SELECT },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: BRAND_KIT_SELECT }),
    ]);
    return mergeBrandKitFields(workspace.isPersonal ? null : workspace, owner);
  }

  // Brand Kit roadmap (P3a) - resolves the effective (workspace-merged, see
  // resolveEffectiveBrandKit) font, same "resolve once at enqueue time"
  // shape as every other RenderClipJobData field. null (both when
  // applyBrandKit is false and when nothing has ever set a font) means "use
  // build-ass.ts's own default".
  //
  // Subtitle Presets roadmap (P3b) - clipFontFamily (the per-clip override,
  // e.g. from picking a preset) is checked FIRST and short-circuits the
  // Brand Kit lookup entirely when set - a deliberate per-clip choice always
  // wins regardless of applyBrandKit.
  private resolveFontFamily(
    brandKit: BrandKitFields,
    applyBrandKit: boolean,
    clipFontFamily: string | null,
  ): string | null {
    if (clipFontFamily) return clipFontFamily;
    if (!applyBrandKit) return null;
    return brandKit.brandFontFamily;
  }

  // Watermark roadmap (P3c) - resolves the effective Brand Kit watermark,
  // same "resolve once" shape as resolveFontFamily. clipWatermarkEnabled is
  // a plain on/off gate (not a per-clip value override the way
  // clipFontFamily is). Returns null (not just "no watermark configured")
  // when brandWatermarkUrl itself is unset, so a clip with
  // watermarkEnabled=true but no Brand Kit watermark configured renders
  // exactly as if it had none - no error, no placeholder.
  private resolveWatermark(
    brandKit: BrandKitFields,
    clipWatermarkEnabled: boolean,
  ): RenderClipJobData['watermark'] {
    if (!clipWatermarkEnabled) return null;
    if (!brandKit.brandWatermarkUrl) return null;
    return {
      key: brandKit.brandWatermarkUrl,
      opacity: brandKit.brandWatermarkOpacity ?? DEFAULT_WATERMARK_OPACITY,
      scale: brandKit.brandWatermarkScale ?? DEFAULT_WATERMARK_SCALE,
      margin: brandKit.brandWatermarkMargin ?? DEFAULT_WATERMARK_MARGIN,
      position:
        (brandKit.brandWatermarkPosition as WatermarkPosition | null) ?? DEFAULT_WATERMARK_POSITION,
    };
  }

  // Intro roadmap (P3d) - same shape/reasoning as resolveWatermark above.
  // imageDurationSeconds is passed through as-is (null included) - the
  // DEFAULT_INTRO_IMAGE_DURATION_SECONDS fallback is applied by
  // apps/worker's concatIntro() at render time, not here, since it's only
  // ever relevant when type is 'image'.
  private resolveIntro(
    brandKit: BrandKitFields,
    clipIntroEnabled: boolean,
  ): RenderClipJobData['intro'] {
    if (!clipIntroEnabled) return null;
    if (!brandKit.brandIntroUrl || !brandKit.brandIntroType) return null;
    return {
      key: brandKit.brandIntroUrl,
      type: brandKit.brandIntroType as IntroType,
      imageDurationSeconds: brandKit.brandIntroImageDurationSeconds,
    };
  }

  // Outro roadmap (P3e) - same shape/reasoning as resolveIntro above.
  private resolveOutro(
    brandKit: BrandKitFields,
    clipOutroEnabled: boolean,
  ): RenderClipJobData['outro'] {
    if (!clipOutroEnabled) return null;
    if (!brandKit.brandOutroUrl || !brandKit.brandOutroType) return null;
    return {
      key: brandKit.brandOutroUrl,
      type: brandKit.brandOutroType as IntroType,
      imageDurationSeconds: brandKit.brandOutroImageDurationSeconds,
    };
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
    durationSeconds: number | null;
    viralityScore: number;
    outputUrl: string | null;
    thumbnailUrl: string | null;
    thumbnailBlurDataUrl: string | null;
    animatedThumbnailUrl: string | null;
    hoverPreviewUrl: string | null;
    storyboardFrameUrls: unknown;
    captionStyle: CaptionStyle;
    speakerColorCaptions: boolean;
    smartSegmentation: boolean;
    dynamicCaptions: boolean;
    captionLanguage: string | null;
    applyBrandKit: boolean;
    fontFamily: string | null;
    watermarkEnabled: boolean;
    introEnabled: boolean;
    outroEnabled: boolean;
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
    hookPrediction: unknown;
    semanticEvents: unknown;
    narrativeGraph: unknown;
    contextualMomentum: unknown;
    emotionalArc: unknown;
    multiSpeakerBreakdown: unknown;
    viralityPrediction: unknown;
    retentionCurveInsights: unknown;
    multimodalReasoning: unknown;
    subtitleIntelligence: unknown;
    captionTreatment: unknown;
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
      durationSeconds: clip.durationSeconds,
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
      speakerColorCaptions: clip.speakerColorCaptions,
      smartSegmentation: clip.smartSegmentation,
      dynamicCaptions: clip.dynamicCaptions,
      captionLanguage: clip.captionLanguage,
      applyBrandKit: clip.applyBrandKit,
      fontFamily: clip.fontFamily,
      watermarkEnabled: clip.watermarkEnabled,
      introEnabled: clip.introEnabled,
      outroEnabled: clip.outroEnabled,
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
      hookPrediction: toSharedHookPrediction(clip.hookPrediction),
      semanticEvents: toSharedSemanticEvents(clip.semanticEvents),
      narrativeGraph: toSharedNarrativeGraph(clip.narrativeGraph),
      contextualMomentum: toSharedContextualMomentum(clip.contextualMomentum),
      emotionalArc: toSharedEmotionalArc(clip.emotionalArc),
      multiSpeakerBreakdown: toSharedMultiSpeakerBreakdown(clip.multiSpeakerBreakdown),
      viralityPrediction: toSharedViralityPrediction(clip.viralityPrediction),
      retentionCurveInsights: toSharedRetentionCurveInsights(clip.retentionCurveInsights),
      multimodalReasoning: toSharedMultimodalReasoning(clip.multimodalReasoning),
      subtitleIntelligence: toSharedSubtitleIntelligence(clip.subtitleIntelligence),
      captionTreatment: toSharedCaptionTreatment(clip.captionTreatment),
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
