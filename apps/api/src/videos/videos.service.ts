import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  derivePipelineThreadPresentation,
  Prisma,
  recordActivityEvent,
  recordAuditLog,
  recordNotification,
  recordThreadNotification,
  recordVideoStatusEvent,
  updateVideoStatus,
  VideoStatus,
  WorkspaceRole,
  type Video,
} from '@speedora/database';
import { buildClipMetadataReport, buildVideoReportData } from '@speedora/report-builder';
import type { ClipMetadataOutput, TimelineEvent, VideoReportData } from '@speedora/contracts';
import {
  DETECT_CLIPS_RETRY_OPTIONS,
  filterSegmentsForClip,
  GENERATE_MORE_CLIPS_RETRY_OPTIONS,
  IMPORT_YOUTUBE_RETRY_OPTIONS,
  mergeBrandKitFields,
  PROBE_VIDEO_RETRY_OPTIONS,
  QueueName,
  RENDER_CLIP_RETRY_OPTIONS,
  TRANSCRIBE_RETRY_OPTIONS,
  TranscriptionProvider,
  type BrandKitFields,
  type DetectClipsJobData,
  type GenerateMoreClipsJobData,
  type ImportYoutubeJobData,
  type IntroType,
  type ProbeVideoJobData,
  type ProcessingOptions,
  type RenderClipJobData,
  type ThumbnailFallbackLevel,
  type TranscribeJobData,
  type TranslateTranscriptJobData,
  type WatermarkPosition,
} from '@speedora/shared';
import { Queue } from 'bullmq';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import { toSharedPublishRecord } from '../social/publish-record.util';
import { StorageService } from '../storage/storage.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { buildClipMetadataCsv, toClipMetadataInput } from './clip-metadata.util';
import { buildSrtCaptions, buildTranscriptTxt, buildVttCaptions } from './transcript-export.util';
import {
  buildVideoReportCsv,
  buildVideoReportHtml,
  buildVideoReportInput,
  buildVideoReportMarkdown,
} from './video-report.util';
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
  toSharedLipSyncVerifications,
  toSharedLlmFeatures,
  toSharedOcrFeatures,
  toSharedOcrText,
  toSharedProcessingOptions,
  toSharedValidationReport,
  toSharedCameraMotion,
  toSharedCameraMotionFeatures,
  toSharedCompositionFeatures,
  toSharedDiarizationFeatures,
  toSharedEditingRhythmFeatures,
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
  toSharedTranscriptionProvider,
  toSharedTranscriptSegment,
  toSharedVoiceActivityFeatures,
  toSharedVoiceActivitySegments,
} from './transcript-segment.util';

const NO_PREMIUM_CREDIT_MESSAGE =
  'No premium (OpenAI Whisper) credit available - complete payment before uploading with this provider';

// Subtitle Studio roadmap (P2f) - same per-day-cap guardrail as Publishing
// Expansion Phase 7B's MAX_PLATFORM_COPY_GENERATIONS_PER_DAY (ClipsService),
// bounding this new open LLM-cost surface (one call per video per language,
// but a video's whole transcript in one prompt - larger than platform
// copy's single-clip prompt).
const MAX_TRANSLATE_REQUESTS_PER_DAY = 5;
const TRANSLATE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const CLIPS_WITH_PUBLISH_RECORDS = {
  orderBy: { viralityScore: 'desc' },
  include: { publishRecords: { include: { socialAccount: true } } },
} as const;

// Dashboard Improvement Sprint Phase B ("View All" video processing
// history) - VideoStatus has no CANCELLED value, so the history status
// filter only offers these three; RUNNING covers every non-terminal stage.
const HISTORY_STATUS_FILTER_MAP: Record<'COMPLETED' | 'RUNNING' | 'FAILED', VideoStatus[]> = {
  COMPLETED: [VideoStatus.RENDERED],
  FAILED: [VideoStatus.FAILED],
  RUNNING: [
    VideoStatus.IMPORTING,
    VideoStatus.UPLOADED,
    VideoStatus.PENDING_SETTINGS,
    VideoStatus.TRANSCRIBED,
    VideoStatus.CLIPS_DETECTED,
  ],
};

// PR #37 review fix - `dateTo` arrives as a calendar date at UTC midnight
// (parseDate('2026-02-01') -> 2026-02-01T00:00:00.000Z). Comparing
// createdAt <= that instant excluded almost the entire selected day (only
// videos created in its very first millisecond matched). The fix: compare
// against the START OF THE NEXT DAY with `<` instead, so "through Feb 1"
// really includes all of Feb 1.
function endOfDayExclusive(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// Watermark roadmap (P3c) - same defaults as ClipsService's own
// DEFAULT_WATERMARK_* constants, duplicated here rather than exported/
// shared - same "each render-enqueue site inlines its own resolution"
// convention the fontFamily precedence already established across these
// three call sites (ClipsService.render(), this retry(), detect-clips.
// worker.ts's initial render).
const DEFAULT_WATERMARK_OPACITY = 0.8;
const DEFAULT_WATERMARK_SCALE = 0.15;
const DEFAULT_WATERMARK_MARGIN = 0.03;
const DEFAULT_WATERMARK_POSITION: WatermarkPosition = 'BOTTOM_RIGHT';

// Workspace-level Brand Kit roadmap (P3g) - same shape as ClipsService's
// own BRAND_KIT_SELECT, inlined here for the same "each service resolves
// its own Brand Kit reads independently" reasoning as the DEFAULT_WATERMARK_*
// constants above.
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

type VideoWithClips = Prisma.VideoGetPayload<{
  include: { clips: typeof CLIPS_WITH_PUBLISH_RECORDS };
}>;

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly payments: PaymentsService,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly notificationPublisher: NotificationPublisherService,
    private readonly notificationDeliveryProducer: NotificationDeliveryProducer,
    @InjectQueue(QueueName.IMPORT_YOUTUBE)
    private readonly importYoutubeQueue: Queue<ImportYoutubeJobData>,
    @InjectQueue(QueueName.PROBE_VIDEO)
    private readonly probeVideoQueue: Queue<ProbeVideoJobData>,
    @InjectQueue(QueueName.TRANSCRIBE) private readonly transcribeQueue: Queue<TranscribeJobData>,
    @InjectQueue(QueueName.DETECT_CLIPS)
    private readonly detectClipsQueue: Queue<DetectClipsJobData>,
    @InjectQueue(QueueName.RENDER_CLIP) private readonly renderClipQueue: Queue<RenderClipJobData>,
    @InjectQueue(QueueName.TRANSLATE_TRANSCRIPT)
    private readonly translateTranscriptQueue: Queue<TranslateTranscriptJobData>,
    @InjectQueue(QueueName.GENERATE_MORE_CLIPS)
    private readonly generateMoreClipsQueue: Queue<GenerateMoreClipsJobData>,
  ) {}

  // Explicit Promise<Video> return type (rather than inferred) - Video now
  // has a Json? column (voiceActivitySegments, Speaker Intelligence
  // roadmap Milestone A), and an un-annotated inferred return type here
  // pulls Prisma's opaque internal Json runtime type into this method's
  // declaration emit, breaking `nest build` (TS2742) - same root cause as
  // the Clip Json-field leaks documented in prisma.md, just surfacing here
  // as "annotate the return type" instead of "destructure out of a spread"
  // since this method returns a bare tx.video.create() result, not a
  // spread object.
  async upload(
    ownerId: string,
    file: Express.Multer.File,
    provider: TranscriptionProvider,
    workspaceId?: string,
    processingOptions?: ProcessingOptions,
  ): Promise<Video> {
    // Cheap check before ever touching storage - fails fast rather than
    // wasting a (potentially large) upload on a request that's going to be
    // rejected anyway. The real, race-safe guarantee is consumeCredit()'s
    // atomic claim below; this is purely an optimization.
    if (provider === TranscriptionProvider.OPENAI) {
      const { available } = await this.payments.getAvailability(ownerId);
      if (!available) {
        throw new BadRequestException(NO_PREMIUM_CREDIT_MESSAGE);
      }
    }

    // Sprint 5A (Collaboration Foundation) - an explicit workspaceId
    // (EDITOR+ required) lets a member upload directly into a shared
    // workspace; omitted defaults to the uploader's own personal workspace,
    // preserving every pre-5A caller's behavior exactly.
    let targetWorkspaceId: string;
    if (workspaceId) {
      await this.workspaceAccess.assertMinRole(ownerId, workspaceId, WorkspaceRole.EDITOR);
      targetWorkspaceId = workspaceId;
    } else {
      targetWorkspaceId = await this.workspaceAccess.getPersonalWorkspaceId(ownerId);
    }

    const { sourceUrl } = await this.storage.saveVideo(file);

    const video = await this.prisma.$transaction(async (tx) => {
      const created = await tx.video.create({
        data: {
          ownerId,
          workspaceId: targetWorkspaceId,
          sourceUrl,
          transcriptionProvider: provider,
          // originalname/buffer.length are both already in memory - multer's
          // default (memory) storage, no extra I/O (see
          // storage.service.ts's own read of file.originalname).
          title: file.originalname,
          sourceSizeBytes: file.buffer.length,
          // Pre-Processing Settings roadmap (Phase 0/1) - a plain snapshot,
          // same "chosen at upload time, never re-resolved" shape as
          // transcriptionProvider above. Prisma.JsonNull (not a bare null -
          // see docs/prisma.md) when the caller skipped the settings screen
          // entirely (an older client, or a test).
          processingOptions:
            (processingOptions as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      // First entry in this video's status history - see
      // ARCHITECTURE.md's Fase 3 section for why creation needs its own
      // event write rather than going through updateVideoStatus() (there's
      // no existing row yet for that helper's update() half to update).
      await recordVideoStatusEvent(tx, created.id, created.status);
      return created;
    });

    if (provider === TranscriptionProvider.OPENAI) {
      await this.claimCreditOrRollback(ownerId, video.id, async () => {
        await this.storage.deleteObjects([sourceUrl]);
      });
    }

    // Quality Validation roadmap (Fase 0 design, Phase 1) - PROBE_VIDEO,
    // not TRANSCRIBE directly (see QueueName.PROBE_VIDEO's own comment).
    // TRANSCRIBE is now only ever enqueued by startProcessing() below, once
    // probing succeeds and the user has submitted Processing Settings.
    await this.probeVideoQueue.add(
      QueueName.PROBE_VIDEO,
      { videoId: video.id, sourceUrl: video.sourceUrl },
      PROBE_VIDEO_RETRY_OPTIONS,
    );

    // Sprint 1-2 (Dashboard Redesign) - Dashboard's Activity Timeline. Fire
    // after the transaction commits, same "don't let a secondary feed's
    // write fail the primary action" posture as other best-effort side
    // effects in this service (e.g. storage cleanup above).
    await recordActivityEvent(this.prisma, {
      userId: ownerId,
      type: 'VIDEO_UPLOADED',
      videoId: video.id,
      metadata: { title: video.title },
    });

    // Notification Center Sprint 4A - Upload Complete. Milestone 04c -
    // deps.publish pushes this over SSE in realtime.
    await recordNotification(
      this.prisma,
      {
        userId: ownerId,
        type: 'UPLOAD_COMPLETE',
        title: 'Upload selesai',
        body: `Video "${video.title}" berhasil diunggah dan sedang diproses.`,
        videoId: video.id,
      },
      {
        publish: (event) => this.notificationPublisher.publish(event),
        enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
      },
    ).catch((error) => this.logger.warn(`failed to record UPLOAD_COMPLETE notification: ${error}`));

    // Notification Center v2 Phase 2 - Smart Timeline thread creation. This
    // is the first update for this video's thread (video.status is UPLOADED,
    // the schema default for a direct upload - see recordVideoStatusEvent's
    // own comment above for why creation doesn't go through
    // updateVideoStatus()). Every later stage transition updates this SAME
    // thread (threadKey PIPELINE:<videoId>) via updateVideoStatus()'s own
    // hook - see derivePipelineThreadPresentation(). Wrapped in try/catch
    // (not just recordThreadNotification's own .catch()) since
    // derivePipelineThreadPresentation() runs synchronously BEFORE that
    // call - a secondary write's failure must never break the primary
    // upload action, same discipline as every other best-effort side effect
    // in this method.
    try {
      const uploadPresentation = derivePipelineThreadPresentation(video.status, {
        title: video.title,
      });
      await recordThreadNotification(
        this.prisma,
        {
          userId: ownerId,
          type: uploadPresentation.type,
          title: uploadPresentation.title,
          body: uploadPresentation.body,
          category: uploadPresentation.category,
          threadKey: `PIPELINE:${video.id}`,
          status: uploadPresentation.threadStatus,
          videoId: video.id,
        },
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      );
    } catch (error) {
      this.logger.warn(`failed to record pipeline thread notification: ${error}`);
    }

    return video;
  }

  // url is already validated as a youtube.com/youtu.be link by
  // ImportYoutubeDto - actually downloading it is apps/worker's job
  // (import-youtube.worker.ts), same "API layer never does heavy work
  // synchronously" split as every other stage (see CLAUDE.md's Keputusan
  // Arsitektur). sourceUrl starts as '' (see schema.prisma's comment on
  // Video.sourceUrl) since there's no object storage key yet.
  // Same TS2742 reasoning as upload()'s own comment above.
  async importFromYoutube(
    ownerId: string,
    url: string,
    provider: TranscriptionProvider,
    workspaceId?: string,
    processingOptions?: ProcessingOptions,
  ): Promise<Video> {
    if (provider === TranscriptionProvider.OPENAI) {
      const { available } = await this.payments.getAvailability(ownerId);
      if (!available) {
        throw new BadRequestException(NO_PREMIUM_CREDIT_MESSAGE);
      }
    }

    // Same "explicit workspaceId requires EDITOR+, omitted defaults to the
    // requester's personal workspace" convention as upload() above.
    let targetWorkspaceId: string;
    if (workspaceId) {
      await this.workspaceAccess.assertMinRole(ownerId, workspaceId, WorkspaceRole.EDITOR);
      targetWorkspaceId = workspaceId;
    } else {
      targetWorkspaceId = await this.workspaceAccess.getPersonalWorkspaceId(ownerId);
    }

    const video = await this.prisma.$transaction(async (tx) => {
      const created = await tx.video.create({
        data: {
          ownerId,
          workspaceId: targetWorkspaceId,
          sourceUrl: '',
          importSourceUrl: url,
          status: VideoStatus.IMPORTING,
          transcriptionProvider: provider,
          // Pre-Processing Settings roadmap (Phase 0/1) - see upload()'s
          // own comment on this same field.
          processingOptions:
            (processingOptions as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      await recordVideoStatusEvent(tx, created.id, created.status);
      return created;
    });

    if (provider === TranscriptionProvider.OPENAI) {
      await this.claimCreditOrRollback(ownerId, video.id);
    }

    await this.importYoutubeQueue.add(
      QueueName.IMPORT_YOUTUBE,
      { videoId: video.id, url, provider },
      IMPORT_YOUTUBE_RETRY_OPTIONS,
    );

    // title isn't known yet at this point - import-youtube.worker.ts fetches
    // it once the yt-dlp job actually runs. See upload()'s own call for the
    // direct-upload path, which does have a title synchronously.
    await recordActivityEvent(this.prisma, {
      userId: ownerId,
      type: 'VIDEO_UPLOADED',
      videoId: video.id,
    });

    // Notification Center Sprint 4A - Upload Complete. Title isn't known yet
    // at this point (see recordActivityEvent's own comment above) - the
    // notification just confirms the import started. Milestone 04c -
    // deps.publish pushes this over SSE in realtime.
    await recordNotification(
      this.prisma,
      {
        userId: ownerId,
        type: 'UPLOAD_COMPLETE',
        title: 'Import YouTube dimulai',
        body: 'Video dari YouTube Anda sedang diunduh dan diproses.',
        videoId: video.id,
      },
      {
        publish: (event) => this.notificationPublisher.publish(event),
        enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
      },
    ).catch((error) => this.logger.warn(`failed to record UPLOAD_COMPLETE notification: ${error}`));

    // Notification Center v2 Phase 2 - Smart Timeline thread creation, same
    // reasoning (and try/catch, not just .catch()) as upload()'s own call
    // above. video.status is IMPORTING here (explicit at creation for the
    // YouTube-import path).
    try {
      const importPresentation = derivePipelineThreadPresentation(video.status, {
        title: video.title,
      });
      await recordThreadNotification(
        this.prisma,
        {
          userId: ownerId,
          type: importPresentation.type,
          title: importPresentation.title,
          body: importPresentation.body,
          category: importPresentation.category,
          threadKey: `PIPELINE:${video.id}`,
          status: importPresentation.threadStatus,
          videoId: video.id,
        },
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      );
    } catch (error) {
      this.logger.warn(`failed to record pipeline thread notification: ${error}`);
    }

    return video;
  }

  // Atomically claims one paid, unspent PremiumCredit for videoId - the
  // video row must already exist first (PremiumCredit.videoId is a real FK).
  // A race lost against a concurrent request (the pre-check above passed,
  // but the credit was claimed by someone else before this ran) is handled
  // by deleting the just-created video (plus any storage object already
  // written for it) rather than leaving an orphaned, permanently-stuck
  // OPENAI-provider video with no credit behind it.
  private async claimCreditOrRollback(
    ownerId: string,
    videoId: string,
    cleanupStorage?: () => Promise<void>,
  ): Promise<void> {
    const claimed = await this.payments.consumeCredit(ownerId, videoId);
    if (claimed) return;

    await this.prisma.video.delete({ where: { id: videoId } });
    if (cleanupStorage) await cleanupStorage();
    throw new BadRequestException(NO_PREMIUM_CREDIT_MESSAGE);
  }

  // Cursor-based (not offset) - the list is polled every 2s while videos are
  // actively being created, and offset pagination would skip/duplicate rows
  // as new ones land ahead of an in-progress page walk. `cursor` is a
  // previously-returned video id; `limit+1` is fetched so the extra row
  // (never returned) tells us whether there's a next page without a second
  // count query.
  // Sprint 5A (Collaboration Foundation) - scoped by workspace, not owner:
  // an explicit workspaceId (any membership, VIEWER+) lists that shared
  // workspace's videos; omitted defaults to the requester's own personal
  // workspace, which for every user who has never created/joined a team
  // workspace is exactly the same set of videos this returned before.
  // projectId/folderId further narrow within that workspace - passing
  // projectId alone resolves its owning workspace automatically (the
  // frontend's Project/Folder panel never needs to pass both).
  async findAll(
    requesterId: string,
    {
      cursor,
      limit,
      workspaceId,
      projectId,
      folderId,
    }: {
      cursor?: string;
      limit: number;
      workspaceId?: string;
      projectId?: string;
      folderId?: string;
    },
  ) {
    let targetWorkspaceId: string;
    if (projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }
      targetWorkspaceId = project.workspaceId;
      await this.workspaceAccess.assertMinRole(
        requesterId,
        targetWorkspaceId,
        WorkspaceRole.VIEWER,
      );
    } else if (workspaceId) {
      await this.workspaceAccess.assertMinRole(requesterId, workspaceId, WorkspaceRole.VIEWER);
      targetWorkspaceId = workspaceId;
    } else {
      targetWorkspaceId = await this.workspaceAccess.getPersonalWorkspaceId(requesterId);
    }

    const videos = await this.prisma.video.findMany({
      where: {
        workspaceId: targetWorkspaceId,
        ...(projectId ? { projectId } : {}),
        ...(folderId ? { folderId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { clips: CLIPS_WITH_PUBLISH_RECORDS },
    });

    const hasMore = videos.length > limit;
    const page = hasMore ? videos.slice(0, limit) : videos;

    return {
      videos: page.map((video) => this.mapVideoWithClips(video)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Dashboard Improvement Sprint Phase B ("View All" video processing
  // history) - a deliberately separate endpoint/method from findAll, which
  // is the poll-hot-path (2s interval from the Dashboard) findAll's own
  // comment above documents the correctness reason for. Bolting a 4-way
  // sort, 5 new filters, and a raw-SQL branch onto that path risked
  // regressing it; this method leaves findAll byte-for-byte untouched.
  //
  // newest/oldest reuse findAll's exact cursor idiom (no computed column
  // needed). processingTime/topScore key off values Prisma's query builder
  // cannot ORDER BY (a to-many relation's MAX(), and a computed
  // first->last-VideoStatusEvent span) - once the ORDER BY has to be raw
  // SQL, the WHERE/pagination boundary has to move into the same query too
  // (a video excluded by a Prisma-side WHERE could be exactly the row that
  // determines the raw-SQL page boundary), so those two sorts use
  // page-number pagination instead of a cursor. This page is never
  // live-polled (unlike GET /videos), so the small risk of a boundary row
  // shifting by one page mid-browse if a video's score/processing-time
  // changes while paging is an accepted, documented tradeoff - not a
  // live-feed dup/skip bug.
  async findHistory(
    requesterId: string,
    {
      cursor,
      page = 1,
      limit,
      workspaceId,
      ownerId,
      status,
      search,
      dateFrom,
      dateTo,
      sortBy = 'newest',
    }: {
      cursor?: string;
      page?: number;
      limit: number;
      workspaceId?: string;
      ownerId?: string;
      status?: 'COMPLETED' | 'RUNNING' | 'FAILED';
      search?: string;
      dateFrom?: Date;
      dateTo?: Date;
      sortBy?: 'newest' | 'oldest' | 'processingTime' | 'topScore';
    },
  ) {
    let targetWorkspaceId: string;
    if (workspaceId) {
      await this.workspaceAccess.assertMinRole(requesterId, workspaceId, WorkspaceRole.VIEWER);
      targetWorkspaceId = workspaceId;
    } else {
      targetWorkspaceId = await this.workspaceAccess.getPersonalWorkspaceId(requesterId);
    }

    const statusList = status ? HISTORY_STATUS_FILTER_MAP[status] : undefined;
    // Computed once here (not duplicated per branch) - see
    // endOfDayExclusive's comment for why this isn't just `dateTo` as-is.
    const dateToExclusive = dateTo ? endOfDayExclusive(dateTo) : undefined;

    if (sortBy === 'newest' || sortBy === 'oldest') {
      return this.findHistoryByDate(targetWorkspaceId, {
        cursor,
        limit,
        ownerId,
        statusList,
        search,
        dateFrom,
        dateToExclusive,
        sortBy,
      });
    }

    return this.findHistoryByComputedSort(targetWorkspaceId, {
      page,
      limit,
      ownerId,
      statusList,
      search,
      dateFrom,
      dateToExclusive,
      sortBy,
    });
  }

  private async findHistoryByDate(
    targetWorkspaceId: string,
    {
      cursor,
      limit,
      ownerId,
      statusList,
      search,
      dateFrom,
      dateToExclusive,
      sortBy,
    }: {
      cursor?: string;
      limit: number;
      ownerId?: string;
      statusList?: VideoStatus[];
      search?: string;
      dateFrom?: Date;
      // Already the start of the day AFTER the user's selected end date
      // (see endOfDayExclusive) - compared with `lt`, not `lte`.
      dateToExclusive?: Date;
      sortBy: 'newest' | 'oldest';
    },
  ) {
    const videos = await this.prisma.video.findMany({
      where: {
        workspaceId: targetWorkspaceId,
        ...(ownerId ? { ownerId } : {}),
        ...(statusList ? { status: { in: statusList } } : {}),
        ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(dateFrom || dateToExclusive
          ? {
              createdAt: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateToExclusive ? { lt: dateToExclusive } : {}),
              },
            }
          : {}),
      },
      orderBy:
        sortBy === 'oldest'
          ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
          : [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        ownerId: true,
        workspaceId: true,
        clips: { select: { viralityScore: true }, orderBy: { viralityScore: 'desc' }, take: 1 },
        _count: { select: { clips: true } },
        statusEvents: { select: { createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    const hasMore = videos.length > limit;
    const page = hasMore ? videos.slice(0, limit) : videos;

    return {
      videos: page.map((video) => this.mapVideoHistoryRow(video)),
      sortBy,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      page: null,
      totalPages: null,
      totalCount: null,
    };
  }

  // Same processing-time formula as DashboardService.getStats
  // (apps/api/src/dashboard/dashboard.service.ts) - duplicated, not shared,
  // matching this codebase's existing per-call-site-copy convention (see
  // parseLimit's own comment on this in videos.controller.ts).
  private mapVideoHistoryRow(video: {
    id: string;
    title: string | null;
    status: VideoStatus;
    createdAt: Date;
    ownerId: string;
    workspaceId: string;
    clips: { viralityScore: number }[];
    _count: { clips: number };
    statusEvents: { createdAt: Date }[];
  }) {
    const isTerminal = video.status === VideoStatus.RENDERED || video.status === VideoStatus.FAILED;
    const processingTimeSeconds =
      isTerminal && video.statusEvents.length >= 2
        ? (video.statusEvents[video.statusEvents.length - 1].createdAt.getTime() -
            video.statusEvents[0].createdAt.getTime()) /
          1000
        : null;

    return {
      id: video.id,
      title: video.title,
      status: video.status,
      createdAt: video.createdAt.toISOString(),
      ownerId: video.ownerId,
      workspaceId: video.workspaceId,
      processingTimeSeconds,
      topClipScore: video.clips[0]?.viralityScore ?? null,
      clipCount: video._count.clips,
    };
  }

  // The ORDER BY here depends on a per-row aggregate Prisma's findMany
  // cannot express, so the WHERE/pagination boundary has to live in the
  // same raw query (see findHistory's comment for why). Every interpolated
  // value stays a bound parameter via Prisma.sql's tagged template - never
  // string-concatenated - same safe pattern as ClipsService.getTopicFacets
  // (apps/api/src/clips/clips.service.ts).
  private async findHistoryByComputedSort(
    targetWorkspaceId: string,
    {
      page,
      limit,
      ownerId,
      statusList,
      search,
      dateFrom,
      dateToExclusive,
      sortBy,
    }: {
      page: number;
      limit: number;
      ownerId?: string;
      statusList?: VideoStatus[];
      search?: string;
      dateFrom?: Date;
      // Already the start of the day AFTER the user's selected end date
      // (see endOfDayExclusive) - compared with `<`, not `<=`.
      dateToExclusive?: Date;
      sortBy: 'processingTime' | 'topScore';
    },
  ) {
    const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

    const whereFragment = Prisma.sql`
      v."workspaceId" = ${targetWorkspaceId}
      ${ownerId ? Prisma.sql`AND v."ownerId" = ${ownerId}` : Prisma.empty}
      ${statusList ? Prisma.sql`AND v.status::text IN (${Prisma.join(statusList)})` : Prisma.empty}
      ${search ? Prisma.sql`AND v.title ILIKE ${`%${search}%`}` : Prisma.empty}
      ${dateFrom ? Prisma.sql`AND v."createdAt" >= ${dateFrom}` : Prisma.empty}
      ${dateToExclusive ? Prisma.sql`AND v."createdAt" < ${dateToExclusive}` : Prisma.empty}
    `;

    const orderFragment =
      sortBy === 'topScore'
        ? Prisma.sql`"topClipScore" DESC NULLS LAST, v.id DESC`
        : Prisma.sql`"processingTimeSeconds" DESC NULLS LAST, v.id DESC`;

    type RawRow = {
      id: string;
      title: string | null;
      status: VideoStatus;
      createdAt: Date;
      ownerId: string;
      workspaceId: string;
      topClipScore: number | null;
      clipCount: number;
      processingTimeSeconds: number | null;
    };

    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRaw<RawRow[]>`
        SELECT
          v.id, v.title, v.status, v."createdAt", v."ownerId", v."workspaceId",
          (SELECT MAX(c."viralityScore") FROM "Clip" c WHERE c."videoId" = v.id) AS "topClipScore",
          (SELECT COUNT(*)::int FROM "Clip" c WHERE c."videoId" = v.id) AS "clipCount",
          CASE WHEN v.status IN ('RENDERED', 'FAILED') THEN (
            SELECT EXTRACT(EPOCH FROM (MAX(e."createdAt") - MIN(e."createdAt")))
            FROM "VideoStatusEvent" e WHERE e."videoId" = v.id HAVING COUNT(*) >= 2
          ) ELSE NULL END AS "processingTimeSeconds"
        FROM "Video" v
        WHERE ${whereFragment}
        ORDER BY ${orderFragment}
        LIMIT ${limit} OFFSET ${(safePage - 1) * limit}
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM "Video" v WHERE ${whereFragment}
      `,
    ]);

    const totalCount = Number(countResult[0]?.count ?? 0);

    return {
      videos: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        ownerId: row.ownerId,
        workspaceId: row.workspaceId,
        processingTimeSeconds: row.processingTimeSeconds,
        topClipScore: row.topClipScore,
        clipCount: row.clipCount,
      })),
      sortBy,
      nextCursor: null,
      page: safePage,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
    };
  }

  // Quality Validation roadmap (Fase 0 design, Phase 1) - POST
  // /videos/:id/start-processing. The only place TRANSCRIBE is enqueued
  // from now (upload()/importFromYoutube() enqueue PROBE_VIDEO instead -
  // see their own comments) - Processing Settings only renders once
  // probing reaches PENDING_SETTINGS, so this is the first point in the new
  // flow processingOptions is actually known. A video not currently
  // PENDING_SETTINGS (still probing, already started, never uploaded)
  // can't be started - there's nothing here to infer/resume, unlike
  // retry() below.
  // Return type deliberately matches retry() below (the fully-mapped
  // findOne() DTO shape - clips, derived thumbnail endpoint paths, etc.),
  // not upload()/importFromYoutube()'s bare Promise<Video> - the frontend
  // treats this response exactly like retry()'s (setVideo(updated) feeding
  // straight into ProcessingStatus/its clips-driven progress math).
  async startProcessing(id: string, requesterId: string, processingOptions: ProcessingOptions) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, video.workspaceId, WorkspaceRole.EDITOR);
    if (video.status !== VideoStatus.PENDING_SETTINGS) {
      throw new BadRequestException(
        'Video is not waiting for Processing Settings (probing not finished, or processing already started)',
      );
    }

    await updateVideoStatus(
      this.prisma,
      id,
      VideoStatus.UPLOADED,
      {
        data: {
          processingOptions: processingOptions as unknown as Prisma.InputJsonValue,
        },
      },
      {
        publish: (event) => this.notificationPublisher.publish(event),
        enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
      },
    );
    await this.transcribeQueue.add(
      QueueName.TRANSCRIBE,
      {
        videoId: id,
        sourceUrl: video.sourceUrl,
        provider: toSharedTranscriptionProvider(video.transcriptionProvider),
      },
      TRANSCRIBE_RETRY_OPTIONS,
    );

    return this.findOne(id, requesterId);
  }

  // Re-enqueues whichever stage actually failed, inferred from what data
  // already exists rather than a stored "failed at" marker: no transcript
  // segments means transcribe never finished, segments-but-no-clips means
  // detect-clips never finished, and clips-without-outputUrl means one or
  // more render-clip jobs failed (each clip renders independently, so a
  // single failed clip doesn't imply the others need retrying too). Safe
  // because transcribe and detect-clips each persist their output and
  // advance status in the same step (see transcribe.worker.ts/
  // detect-clips.worker.ts) - if the job's own catch block ran, that step's
  // data was never written.
  async retry(id: string, requesterId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: true, transcriptSegments: true },
    });

    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, video.workspaceId, WorkspaceRole.EDITOR);
    // A later "Generate More Clips" top-up render can fail without ever
    // flipping Video.status to FAILED (see render-clip.worker.ts's catch
    // block - it deliberately leaves an already-RENDERED video RENDERED so
    // History/export keep classifying it as done). That means the usual
    // FAILED gate below would never let this case be retried, even though
    // there's a real unrendered clip sitting there. Recognize it via the same
    // signal the final branch already uses (an unrendered clip), not a new
    // status value.
    const hasUnrenderedClip = video.clips.some((clip) => !clip.outputUrl);
    const isRetryableTopUp = video.status === VideoStatus.RENDERED && hasUnrenderedClip;
    if (video.status !== VideoStatus.FAILED && !isRetryableTopUp) {
      throw new BadRequestException('Only a failed video can be retried');
    }

    // A video created via import-youtube that failed before the download
    // ever finished still has sourceUrl === '' (see schema.prisma's comment
    // on Video.sourceUrl) - re-running transcribe against that would just
    // fail again trying to read an empty object key. Re-run the import
    // instead, using the YouTube URL saved at creation time.
    if (video.importSourceUrl && video.sourceUrl === '') {
      // importProgress reset immediately, same reasoning as
      // transcribeProgress below - a retry click shouldn't briefly show a
      // stale value from the failed attempt before the worker picks the job
      // back up.
      await updateVideoStatus(
        this.prisma,
        id,
        VideoStatus.IMPORTING,
        { data: { importProgress: 0 } },
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      );
      await this.importYoutubeQueue.add(
        QueueName.IMPORT_YOUTUBE,
        {
          videoId: id,
          url: video.importSourceUrl,
          provider: toSharedTranscriptionProvider(video.transcriptionProvider),
        },
        IMPORT_YOUTUBE_RETRY_OPTIONS,
      );
    } else if (video.durationSeconds == null && video.width == null) {
      // Quality Validation roadmap (Fase 0 design, Phase 1) - probing never
      // completed (or failed an Error-tier check - see
      // probe-video.worker.ts). A video that ever reached TRANSCRIBE always
      // has these populated first (see startProcessing()'s own precondition
      // and updateVideoStatus's call site in probe-video.worker.ts), so
      // their absence here - after the import-in-progress branch above has
      // already been ruled out, meaning sourceUrl is real - means this
      // video never got past PROBE_VIDEO.
      await updateVideoStatus(
        this.prisma,
        id,
        VideoStatus.UPLOADED,
        {},
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      );
      await this.probeVideoQueue.add(
        QueueName.PROBE_VIDEO,
        { videoId: id, sourceUrl: video.sourceUrl },
        PROBE_VIDEO_RETRY_OPTIONS,
      );
    } else if (video.transcriptSegments.length === 0) {
      // transcribeProgress reset immediately (not left to wait for the job
      // itself to reset it) so a retry click doesn't briefly show a stale
      // progress value from the failed attempt before the worker picks the
      // job up.
      await updateVideoStatus(
        this.prisma,
        id,
        VideoStatus.UPLOADED,
        { data: { transcribeProgress: 0 } },
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      );
      await this.transcribeQueue.add(
        QueueName.TRANSCRIBE,
        {
          videoId: id,
          sourceUrl: video.sourceUrl,
          provider: toSharedTranscriptionProvider(video.transcriptionProvider),
        },
        TRANSCRIBE_RETRY_OPTIONS,
      );
    } else if (video.clips.length === 0) {
      await updateVideoStatus(
        this.prisma,
        id,
        VideoStatus.TRANSCRIBED,
        {},
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      );
      await this.detectClipsQueue.add(
        QueueName.DETECT_CLIPS,
        { videoId: id, segments: video.transcriptSegments.map(toSharedTranscriptSegment) },
        DETECT_CLIPS_RETRY_OPTIONS,
      );
    } else {
      const unrendered = video.clips.filter((clip) => !clip.outputUrl);

      if (unrendered.length === 0) {
        // Nothing left to redo - every clip already has output. Shouldn't
        // normally happen (status only becomes FAILED from an active job's
        // catch block), but self-heal rather than error if it does.
        await updateVideoStatus(
          this.prisma,
          id,
          VideoStatus.RENDERED,
          {},
          {
            publish: (event) => this.notificationPublisher.publish(event),
            enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
          },
        );
        return this.findOne(id, requesterId);
      }

      await updateVideoStatus(
        this.prisma,
        id,
        VideoStatus.CLIPS_DETECTED,
        {},
        {
          publish: (event) => this.notificationPublisher.publish(event),
          enqueueDelivery: (event) => this.notificationDeliveryProducer.enqueue(event),
        },
      );
      // Workspace-level Brand Kit roadmap (P3g) - one merged-kit lookup
      // shared by every clip in this video (all belong to the same
      // owner/workspace), same "resolve once at enqueue time" shape as
      // ClipsService.render()'s own resolveEffectiveBrandKit. Skipped
      // entirely when no unrendered clip needs any part of it (every clip
      // either has its own fontFamily override and opted out of everything
      // else, or every Brand-Kit-driven flag is off).
      const needsBrandKit = unrendered.some(
        (clip) =>
          (!clip.fontFamily && clip.applyBrandKit) ||
          clip.watermarkEnabled ||
          clip.introEnabled ||
          clip.outroEnabled,
      );
      let brandKit: BrandKitFields | null = null;
      if (needsBrandKit) {
        const [workspace, owner] = await Promise.all([
          this.prisma.workspace.findUniqueOrThrow({
            where: { id: video.workspaceId },
            select: { isPersonal: true, ...BRAND_KIT_SELECT },
          }),
          this.prisma.user.findUniqueOrThrow({
            where: { id: video.ownerId },
            select: BRAND_KIT_SELECT,
          }),
        ]);
        brandKit = mergeBrandKitFields(workspace.isPersonal ? null : workspace, owner);
      }
      const resolvedWatermark: RenderClipJobData['watermark'] = brandKit?.brandWatermarkUrl
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
      const resolvedIntro: RenderClipJobData['intro'] =
        brandKit?.brandIntroUrl && brandKit.brandIntroType
          ? {
              key: brandKit.brandIntroUrl,
              type: brandKit.brandIntroType as IntroType,
              imageDurationSeconds: brandKit.brandIntroImageDurationSeconds,
            }
          : null;
      const resolvedOutro: RenderClipJobData['outro'] =
        brandKit?.brandOutroUrl && brandKit.brandOutroType
          ? {
              key: brandKit.brandOutroUrl,
              type: brandKit.brandOutroType as IntroType,
              imageDurationSeconds: brandKit.brandOutroImageDurationSeconds,
            }
          : null;
      await Promise.all(
        unrendered.map((clip) =>
          this.renderClipQueue.add(
            QueueName.RENDER_CLIP,
            {
              clipId: clip.id,
              videoId: id,
              sourceUrl: video.sourceUrl,
              startTime: clip.startTime,
              endTime: clip.endTime,
              transcript: filterSegmentsForClip(
                video.transcriptSegments.map(toSharedTranscriptSegment),
                clip.startTime,
                clip.endTime,
              ),
              captionStyle: toSharedCaptionStyle(clip.captionStyle),
              speakerColorCaptions: clip.speakerColorCaptions,
              captionLanguage: clip.captionLanguage,
              fontFamily:
                clip.fontFamily ??
                (clip.applyBrandKit ? (brandKit?.brandFontFamily ?? null) : null),
              watermark: clip.watermarkEnabled ? resolvedWatermark : null,
              intro: clip.introEnabled ? resolvedIntro : null,
              outro: clip.outroEnabled ? resolvedOutro : null,
              keywords: clip.keywords,
              scores: toSharedClipScores(clip.scores),
            },
            RENDER_CLIP_RETRY_OPTIONS,
          ),
        ),
      );
    }

    return this.findOne(id, requesterId);
  }

  // Generate More Clips roadmap (Phase C) - synchronous validation (cheap DB
  // reads only, same "validate here, only the LLM call and render are
  // async" posture as startProcessing/retry above), then enqueue
  // GENERATE_MORE_CLIPS. Never enqueues DETECT_CLIPS/RENDER_CLIP directly -
  // this pipeline stays entirely inside apps/worker, same boundary every
  // other stage already respects.
  async generateMore(
    id: string,
    requesterId: string,
    params: {
      requestedCount: number;
      minClipDurationSeconds?: number;
      maxClipDurationSeconds?: number;
      minConfidence?: number;
      avoidOverlap: boolean;
    },
  ) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, status: true },
    });
    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, video.workspaceId, WorkspaceRole.EDITOR);
    if (video.status !== VideoStatus.RENDERED) {
      throw new BadRequestException('Video belum selesai diproses');
    }
    // Same signal VideosService.retry already uses to infer "a render is
    // still in flight" - catches both "still doing its first render" (should
    // be unreachable given the RENDERED check above, but defensive) and "a
    // previous Generate More request is still in flight" (no separate
    // tracking row exists for that - see the Phase C plan's own reasoning).
    const inFlightClip = await this.prisma.clip.findFirst({
      where: { videoId: id, outputUrl: null },
      select: { id: true },
    });
    if (inFlightClip) {
      throw new BadRequestException('Video sedang diproses');
    }

    await this.generateMoreClipsQueue.add(
      QueueName.GENERATE_MORE_CLIPS,
      { videoId: id, ...params },
      GENERATE_MORE_CLIPS_RETRY_OPTIONS,
    );

    return this.findOne(id, requesterId);
  }

  async findOne(id: string, requesterId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: CLIPS_WITH_PUBLISH_RECORDS },
    });

    // Same "not found" whether the video is missing or the requester has no
    // workspace membership, so a client can't use this endpoint to probe
    // which video IDs exist.
    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, video.workspaceId, WorkspaceRole.VIEWER);

    return this.mapVideoWithClips(video);
  }

  // Used by GET /videos/:id/source (timeline editor's <video> preview) -
  // only needs the object key, not the full clips/status shape findOne()
  // returns.
  async findSourceOrThrow(id: string, requesterId: string): Promise<{ sourceUrl: string }> {
    const video = await this.workspaceAccess.assertVideoAccess(
      requesterId,
      id,
      WorkspaceRole.VIEWER,
    );

    return { sourceUrl: video.sourceUrl };
  }

  // Used by GET /videos/:id/thumbnail (Product Experience roadmap) - same
  // shape/reasoning as findSourceOrThrow above, just for the extracted
  // thumbnail frame instead of the full source video. Callers must check
  // thumbnailUrl for null themselves (extraction is best-effort and may
  // not have succeeded yet, or ever, for this video).
  async findThumbnailOrThrow(
    id: string,
    requesterId: string,
  ): Promise<{ thumbnailUrl: string | null }> {
    const video = await this.workspaceAccess.assertVideoAccess(
      requesterId,
      id,
      WorkspaceRole.VIEWER,
    );

    // Phase 4 of the thumbnail roadmap (AI Thumbnail Selection, Level 1) -
    // prefer the highlightScore-ranked cover clip's thumbnail when one has
    // been promoted, same preference as mapVideoWithClips.
    return { thumbnailUrl: video.coverThumbnailUrl ?? video.thumbnailUrl };
  }

  // Used by GET /videos/:id/animated-thumbnail (Product Experience roadmap,
  // Phase 3) - same shape/reasoning as findThumbnailOrThrow above, for the
  // extracted animated preview instead of the static frame.
  async findAnimatedThumbnailOrThrow(
    id: string,
    requesterId: string,
  ): Promise<{ animatedThumbnailUrl: string | null }> {
    const video = await this.workspaceAccess.assertVideoAccess(
      requesterId,
      id,
      WorkspaceRole.VIEWER,
    );

    return { animatedThumbnailUrl: video.animatedThumbnailUrl };
  }

  // Used by GET /videos/:id/hover-preview (Product Experience roadmap,
  // Phase 3) - same shape/reasoning as findThumbnailOrThrow above, for the
  // longer/smoother preview fetched on-demand only on hover.
  async findHoverPreviewOrThrow(
    id: string,
    requesterId: string,
  ): Promise<{ hoverPreviewUrl: string | null }> {
    const video = await this.workspaceAccess.assertVideoAccess(
      requesterId,
      id,
      WorkspaceRole.VIEWER,
    );

    return { hoverPreviewUrl: video.hoverPreviewUrl };
  }

  // Used by GET /videos/:id/storyboard/:index (Product Experience roadmap,
  // Phase 3) - mirrors findThumbnailOrThrow's shape/reasoning, parameterized
  // by frame index. storyboardFrameUrls only ever needs to expose its COUNT
  // to the DTO (mapVideoWithClips below builds an array of endpoint paths
  // from that count) - the raw keys themselves are only looked up here, at
  // the one call site that actually needs to read a specific frame's bytes
  // from storage.
  async findStoryboardFrameOrThrow(
    id: string,
    requesterId: string,
    index: number,
  ): Promise<{ frameKey: string | null }> {
    const video = await this.workspaceAccess.assertVideoAccess(
      requesterId,
      id,
      WorkspaceRole.VIEWER,
    );

    const frameKeys = toSharedStoryboardFrameKeys(video.storyboardFrameUrls);
    return { frameKey: frameKeys[index] ?? null };
  }

  // Permanently deletes a video, its clips/transcript/publish records (all
  // via onDelete: Cascade in the schema), and the objects they own in
  // storage (the source plus every rendered clip). Same workspace-role-based
  // 404/403 as every other per-video endpoint so it can't be used to probe
  // or delete a video outside the requester's access - ADMIN+ specifically
  // (not just EDITOR) since this is destructive and irreversible. Storage
  // cleanup is best-effort (see StorageService.deleteObjects) - the DB row
  // going away is what actually makes the video "gone" from the user's
  // perspective.
  async remove(id: string, requesterId: string): Promise<void> {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: { select: { outputUrl: true } } },
    });

    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, video.workspaceId, WorkspaceRole.ADMIN);

    const storageKeys = [
      video.sourceUrl,
      ...video.clips.map((clip) => clip.outputUrl ?? ''),
    ].filter((key): key is string => key.length > 0);

    await this.prisma.video.delete({ where: { id } });
    await this.storage.deleteObjects(storageKeys);

    // Sprint 5F (Audit Log) - best-effort, same posture as every other
    // recordAuditLog/recordActivityEvent/recordNotification call site: a
    // lost audit row must never fail the delete itself (already committed
    // by this point).
    await recordAuditLog(this.prisma, {
      workspaceId: video.workspaceId,
      action: 'VIDEO_DELETED',
      actorId: requesterId,
      targetType: 'Video',
      targetId: id,
      metadata: { title: video.title },
    }).catch(() => {});
  }

  // Sprint 5A (Collaboration Foundation) - PATCH /videos/:id/move.
  // Requires EDITOR+ in the video's current workspace (must already be able
  // to edit it) and, when the workspace itself is changing, EDITOR+ in the
  // destination workspace too (must be allowed to add content there).
  // Fields not present in `target` are left unchanged - `null` clears
  // projectId/folderId (moving back to the workspace root), `undefined`
  // (an omitted key) means "don't touch this field."
  async move(
    id: string,
    requesterId: string,
    target: { workspaceId?: string; projectId?: string | null; folderId?: string | null },
  ): Promise<Video> {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, video.workspaceId, WorkspaceRole.EDITOR);

    const targetWorkspaceId = target.workspaceId ?? video.workspaceId;
    if (targetWorkspaceId !== video.workspaceId) {
      await this.workspaceAccess.assertMinRole(
        requesterId,
        targetWorkspaceId,
        WorkspaceRole.EDITOR,
      );
    }

    const targetProjectId = target.projectId !== undefined ? target.projectId : video.projectId;
    const targetFolderId = target.folderId !== undefined ? target.folderId : video.folderId;

    if (targetProjectId) {
      const project = await this.prisma.project.findUnique({ where: { id: targetProjectId } });
      if (!project || project.workspaceId !== targetWorkspaceId) {
        throw new BadRequestException('projectId must belong to the target workspace');
      }
    }
    if (targetFolderId) {
      const folder = await this.prisma.folder.findUnique({ where: { id: targetFolderId } });
      if (!folder || folder.projectId !== targetProjectId) {
        throw new BadRequestException(
          'folderId must belong to projectId within the target workspace',
        );
      }
    }

    const updated = await this.prisma.video.update({
      where: { id },
      data: {
        workspaceId: targetWorkspaceId,
        projectId: targetProjectId,
        folderId: targetFolderId,
      },
    });

    await recordAuditLog(this.prisma, {
      workspaceId: targetWorkspaceId,
      action: 'VIDEO_MOVED',
      actorId: requesterId,
      targetType: 'Video',
      targetId: id,
      metadata: {
        title: video.title,
        fromWorkspaceId: video.workspaceId,
        toWorkspaceId: targetWorkspaceId,
        toProjectId: targetProjectId,
        toFolderId: targetFolderId,
      },
    }).catch(() => {});

    return updated;
  }

  // Separate from findOne()/mapVideoWithClips() on purpose - transcript
  // segments can be a lot of rows for a long video, and findOne() is
  // polled every 2s by both the upload-progress view and the dashboard,
  // neither of which needs caption text. Only the timeline editor does.
  async findTranscriptOrThrow(id: string, requesterId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { transcriptSegments: { orderBy: { start: 'asc' } } },
    });

    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }
    await this.workspaceAccess.assertMinRole(requesterId, video.workspaceId, WorkspaceRole.VIEWER);

    // Subtitle Studio roadmap (P2) - was a hand-duplicated inline mapping
    // missing id/words/translations (this endpoint used to only need
    // caption text/speaker/emotion); switched to the same toShared*
    // narrowing this file already uses elsewhere (findOne/findAll above) so
    // this doesn't drift from it again, and the editor gets id (needed to
    // address a segment for edit/merge/split) and words (needed for a real
    // karaoke live-preview) for free.
    return video.transcriptSegments.map(toSharedTranscriptSegment);
  }

  // Subtitle Studio roadmap (P2a) - manual caption text edit. If the new
  // text's word count no longer matches the stored word-level timestamps,
  // drop `words` (Prisma.JsonNull, not a bare null - see docs/prisma.md)
  // rather than fabricate fake timings: build-ass.ts already falls back to
  // plain (non-karaoke) rendering when `words` is absent, same graceful
  // degradation a segment with no word-level data at all already gets.
  async updateTranscriptSegment(
    videoId: string,
    segmentId: string,
    requesterId: string,
    text: string,
  ) {
    await this.workspaceAccess.assertVideoAccess(requesterId, videoId, WorkspaceRole.EDITOR);

    const existing = await this.prisma.transcriptSegment.findUnique({
      where: { id: segmentId },
    });
    if (!existing || existing.videoId !== videoId) {
      throw new NotFoundException(`Transcript segment ${segmentId} not found`);
    }

    const existingWordCount = Array.isArray(existing.words) ? existing.words.length : 0;
    const newWordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const wordsStillMatch = existingWordCount > 0 && existingWordCount === newWordCount;

    const updated = await this.prisma.transcriptSegment.update({
      where: { id: segmentId },
      data: {
        text,
        ...(wordsStillMatch ? {} : { words: Prisma.JsonNull, speakingRateWordsPerSecond: null }),
      },
    });

    return toSharedTranscriptSegment(updated);
  }

  // Subtitle Studio roadmap (P2b) - combine two chronologically adjacent
  // segments into one, keeping firstSegmentId's row (secondSegmentId's row
  // is deleted). Adjacency is checked against the video's real segment
  // order, not just the two ids' own start/end - this also doubles as the
  // ownership check for both ids at once. `words` is only kept when BOTH
  // segments have it (a partial concatenation would silently break karaoke
  // sync); `translations`/`rmsDb`/`peakDb` are cleared rather than
  // averaged/concatenated into something misleading - merging changes this
  // row's boundaries, so any signal derived from the old boundaries goes
  // stale rather than approximately-right.
  async mergeTranscriptSegments(
    videoId: string,
    requesterId: string,
    firstSegmentId: string,
    secondSegmentId: string,
  ) {
    await this.workspaceAccess.assertVideoAccess(requesterId, videoId, WorkspaceRole.EDITOR);

    const ordered = await this.prisma.transcriptSegment.findMany({
      where: { videoId },
      orderBy: { start: 'asc' },
    });
    const firstIndex = ordered.findIndex((s) => s.id === firstSegmentId);
    if (firstIndex === -1 || ordered[firstIndex + 1]?.id !== secondSegmentId) {
      throw new BadRequestException(
        'firstSegmentId and secondSegmentId must be chronologically adjacent segments of this video',
      );
    }
    const first = ordered[firstIndex];
    const second = ordered[firstIndex + 1];

    const firstWords = Array.isArray(first.words) ? first.words : null;
    const secondWords = Array.isArray(second.words) ? second.words : null;
    const mergedWords = firstWords && secondWords ? [...firstWords, ...secondWords] : null;
    const mergedText = `${first.text} ${second.text}`.replace(/\s+/g, ' ').trim();
    const duration = second.end - first.start;

    const [merged] = await this.prisma.$transaction([
      this.prisma.transcriptSegment.update({
        where: { id: first.id },
        data: {
          text: mergedText,
          end: second.end,
          words: mergedWords ?? Prisma.JsonNull,
          speakingRateWordsPerSecond:
            mergedWords && duration > 0 ? mergedWords.length / duration : null,
          rmsDb: null,
          peakDb: null,
          translations: Prisma.JsonNull,
        },
      }),
      this.prisma.transcriptSegment.delete({ where: { id: second.id } }),
    ]);

    return toSharedTranscriptSegment(merged);
  }

  // Subtitle Studio roadmap (P2b) - split one segment into two at a word
  // boundary. Reuses the original row's id for the first half (so any
  // external reference to it stays valid) and creates one new row for the
  // second half. When the segment has real word-level timestamps, the split
  // point and each half's start/end come directly from Whisper's own word
  // boundaries (exact). When it doesn't (pre-Fase-3 rows), atWordIndex is
  // reinterpreted against a plain whitespace split of `text`, and start/end
  // are derived by character-length ratio - approximate, flagged as such in
  // the response rather than presented as exact.
  async splitTranscriptSegment(
    videoId: string,
    segmentId: string,
    requesterId: string,
    atWordIndex: number,
  ) {
    await this.workspaceAccess.assertVideoAccess(requesterId, videoId, WorkspaceRole.EDITOR);

    const segment = await this.prisma.transcriptSegment.findUnique({ where: { id: segmentId } });
    if (!segment || segment.videoId !== videoId) {
      throw new NotFoundException(`Transcript segment ${segmentId} not found`);
    }

    const hasWords = Array.isArray(segment.words) && segment.words.length > 1;
    let firstData: Prisma.TranscriptSegmentUpdateInput;
    let secondData: Prisma.TranscriptSegmentUncheckedCreateInput;
    let approximate: boolean;

    if (hasWords) {
      const words = segment.words as unknown as { word: string; start: number; end: number }[];
      if (atWordIndex < 1 || atWordIndex >= words.length) {
        throw new BadRequestException(`atWordIndex must be between 1 and ${words.length - 1}`);
      }
      const firstWords = words.slice(0, atWordIndex);
      const secondWords = words.slice(atWordIndex);
      const firstEnd = firstWords[firstWords.length - 1].end;
      const secondStart = secondWords[0].start;
      firstData = {
        text: firstWords.map((w) => w.word).join(' '),
        end: firstEnd,
        words: firstWords,
        speakingRateWordsPerSecond: firstWords.length / (firstEnd - segment.start),
        rmsDb: null,
        peakDb: null,
        translations: Prisma.JsonNull,
      };
      secondData = {
        videoId,
        start: secondStart,
        end: segment.end,
        text: secondWords.map((w) => w.word).join(' '),
        speaker: segment.speaker,
        emotion: segment.emotion,
        words: secondWords,
        speakingRateWordsPerSecond: secondWords.length / (segment.end - secondStart),
      };
      approximate = false;
    } else {
      const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
      if (atWordIndex < 1 || atWordIndex >= tokens.length) {
        throw new BadRequestException(`atWordIndex must be between 1 and ${tokens.length - 1}`);
      }
      const firstText = tokens.slice(0, atWordIndex).join(' ');
      const secondText = tokens.slice(atWordIndex).join(' ');
      const ratio = firstText.length / (firstText.length + secondText.length);
      const splitAt = segment.start + (segment.end - segment.start) * ratio;
      firstData = {
        text: firstText,
        end: splitAt,
        words: Prisma.JsonNull,
        speakingRateWordsPerSecond: null,
        rmsDb: null,
        peakDb: null,
        translations: Prisma.JsonNull,
      };
      secondData = {
        videoId,
        start: splitAt,
        end: segment.end,
        text: secondText,
        speaker: segment.speaker,
        emotion: segment.emotion,
      };
      approximate = true;
    }

    const [first, second] = await this.prisma.$transaction([
      this.prisma.transcriptSegment.update({ where: { id: segment.id }, data: firstData }),
      this.prisma.transcriptSegment.create({ data: secondData }),
    ]);

    return {
      segments: [toSharedTranscriptSegment(first), toSharedTranscriptSegment(second)],
      approximate,
    };
  }

  // Subtitle Studio roadmap (P2f) - enqueues the actual LLM translation
  // (apps/worker's translate-transcript.worker.ts), same "create/log
  // synchronously so the client has something to poll immediately, then
  // enqueue" shape as ClipsService.generatePlatformCopy. No dedicated
  // status row for this job itself (see TranslateTranscriptJobData's own
  // comment) - the TranscriptTranslationRequest row exists purely as the
  // rate-limit counter/history, not a job-status row to poll.
  async translateTranscript(videoId: string, requesterId: string, languageCode: string) {
    await this.workspaceAccess.assertVideoAccess(requesterId, videoId, WorkspaceRole.EDITOR);

    const since = new Date(Date.now() - TRANSLATE_RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.prisma.transcriptTranslationRequest.count({
      where: { requestedBy: requesterId, createdAt: { gte: since } },
    });
    if (recentCount >= MAX_TRANSLATE_REQUESTS_PER_DAY) {
      throw new BadRequestException(
        `Translate limit reached (${MAX_TRANSLATE_REQUESTS_PER_DAY}/24h) - try again later.`,
      );
    }

    await this.prisma.transcriptTranslationRequest.create({
      data: { videoId, requestedBy: requesterId, languageCode },
    });
    await this.translateTranscriptQueue.add(QueueName.TRANSLATE_TRANSCRIPT, {
      videoId,
      languageCode,
    });

    return { status: 'queued' as const, languageCode };
  }

  // Sprint 03b (Export Center) - the video report's JSON format. Reuses
  // findOne/findTranscriptOrThrow rather than a new Prisma query, same
  // "extend, don't rebuild" posture as every other adapter in this
  // codebase - the small cost is a second DB round trip for the transcript,
  // traded for reusing two already-tested, already-ownership-checked
  // methods instead of duplicating their query shape.
  async getVideoReportJson(id: string, requesterId: string): Promise<VideoReportData> {
    const [video, segments, statusEvents] = await Promise.all([
      this.findOne(id, requesterId),
      this.findTranscriptOrThrow(id, requesterId),
      this.getStatusEvents(id),
    ]);
    return buildVideoReportData(buildVideoReportInput(video, segments, statusEvents));
  }

  async getVideoReportCsv(id: string, requesterId: string): Promise<string> {
    return buildVideoReportCsv(await this.getVideoReportJson(id, requesterId));
  }

  // Export format expansion (Phase D) - same one-line shape as
  // getVideoReportCsv above, just a different renderer over the same
  // VideoReportData.
  async getVideoReportMarkdown(id: string, requesterId: string): Promise<string> {
    return buildVideoReportMarkdown(await this.getVideoReportJson(id, requesterId));
  }

  async getVideoReportHtml(id: string, requesterId: string): Promise<string> {
    return buildVideoReportHtml(await this.getVideoReportJson(id, requesterId));
  }

  async getClipMetadataJson(id: string, requesterId: string): Promise<ClipMetadataOutput> {
    const video = await this.findOne(id, requesterId);
    return buildClipMetadataReport(toClipMetadataInput(video.clips));
  }

  async getClipMetadataCsv(id: string, requesterId: string): Promise<string> {
    return buildClipMetadataCsv(await this.getClipMetadataJson(id, requesterId));
  }

  async exportTranscriptTxt(id: string, requesterId: string): Promise<string> {
    return buildTranscriptTxt(await this.findTranscriptOrThrow(id, requesterId));
  }

  async exportCaptionsSrt(id: string, requesterId: string): Promise<string> {
    return buildSrtCaptions(await this.findTranscriptOrThrow(id, requesterId));
  }

  async exportCaptionsVtt(id: string, requesterId: string): Promise<string> {
    return buildVttCaptions(await this.findTranscriptOrThrow(id, requesterId));
  }

  // The Timeline section's data source - VideoStatusEvent has no shared TS
  // type and no other API exposure anywhere in apps/api (confirmed while
  // planning 03a/03b); this is the first read of it. No ownership check of
  // its own - every call site already went through findOne/
  // findTranscriptOrThrow first, which already 404s for a missing/unowned
  // video.
  private async getStatusEvents(videoId: string): Promise<TimelineEvent[]> {
    const events = await this.prisma.videoStatusEvent.findMany({
      where: { videoId },
      orderBy: { createdAt: 'asc' },
    });
    return events.map((event) => ({
      toStatus: event.toStatus,
      occurredAt: event.createdAt.toISOString(),
      errorMessage: event.errorMessage,
    }));
  }

  // Don't leak the server's local filesystem path; the client should hit
  // the download endpoint instead.
  private mapVideoWithClips(video: VideoWithClips) {
    const {
      clips,
      processingOptions,
      validationReport,
      voiceActivitySegments,
      voiceActivityFeatures,
      diarizationFeatures,
      thumbnailUrl,
      thumbnailBlurDataUrl,
      animatedThumbnailUrl,
      hoverPreviewUrl,
      storyboardFrameUrls,
      // Raw storage keys - excluded from `rest` so they never leak, only
      // used to compute thumbnailUrl/thumbnailBlurDataUrl above.
      // coverClipId is left in `rest` and passes through unchanged - it's a
      // plain id, not a storage key, structurally no different from any
      // clip id already visible in the `clips` array below.
      coverThumbnailUrl,
      coverThumbnailBlurDataUrl,
      ...rest
    } = video;
    return {
      ...rest,
      // Never the raw storage key - same "client hits an authenticated
      // endpoint instead" treatment as each clip's downloadUrl/thumbnailUrl
      // below (Product Experience roadmap). Phase 4 of the thumbnail
      // roadmap (AI Thumbnail Selection, Level 1) - the endpoint path is
      // identical either way (findThumbnailOrThrow resolves which raw key
      // backs it), so the only thing that changes here is the presence
      // check preferring the highlightScore-ranked cover clip.
      thumbnailUrl: coverThumbnailUrl || thumbnailUrl ? `/videos/${video.id}/thumbnail` : null,
      // Unlike thumbnailUrl above, this IS the actual inline data - prefer
      // the cover clip's own blur placeholder when one was promoted.
      thumbnailBlurDataUrl: coverThumbnailBlurDataUrl ?? thumbnailBlurDataUrl,
      animatedThumbnailUrl: animatedThumbnailUrl ? `/videos/${video.id}/animated-thumbnail` : null,
      hoverPreviewUrl: hoverPreviewUrl ? `/videos/${video.id}/hover-preview` : null,
      // Only the COUNT of extracted frames is needed here - each entry is an
      // endpoint path, not a raw key (see findStoryboardFrameOrThrow above).
      storyboardFrameUrls: toSharedStoryboardFrameKeys(storyboardFrameUrls).map(
        (_, i) => `/videos/${video.id}/storyboard/${i}`,
      ),
      // Narrowed explicitly, same "un-narrowed Json field breaks
      // declaration emit up the call chain" reasoning as every clip.*
      // field below (Speaker Intelligence roadmap, Milestone A/B - these
      // are the Video-level, not Clip-level, signals).
      processingOptions: toSharedProcessingOptions(processingOptions),
      validationReport: toSharedValidationReport(validationReport),
      voiceActivitySegments: toSharedVoiceActivitySegments(voiceActivitySegments),
      voiceActivityFeatures: toSharedVoiceActivityFeatures(voiceActivityFeatures),
      diarizationFeatures: toSharedDiarizationFeatures(diarizationFeatures),
      clips: clips.map(
        ({
          outputUrl,
          thumbnailUrl: clipThumbnailUrl,
          animatedThumbnailUrl: clipAnimatedThumbnailUrl,
          hoverPreviewUrl: clipHoverPreviewUrl,
          storyboardFrameUrls: clipStoryboardFrameUrls,
          publishRecords,
          scores,
          facialEmotions,
          sceneCutEvents,
          motionEnergy,
          motionEnergyFeatures,
          cameraMotion,
          cameraMotionFeatures,
          editingRhythmFeatures,
          gestures,
          audioFeatures,
          sceneFeatures,
          facialFeatures,
          gestureFeatures,
          faceLandmarks,
          faceLandmarkFeatures,
          trackingQualityMetrics,
          activeSpeakerSamples,
          speakerFaceAssociations,
          lipSyncVerifications,
          speakerTimeline,
          speakerTimelineFeatures,
          speakerConfidenceScores,
          speakerEngagementScores,
          speakerImportanceScores,
          speakerHighlightMoments,
          ocrText,
          ocrTracks,
          ocrFeatures,
          objects,
          objectTracks,
          objectFeatures,
          highlightBreakdown,
          highlightExplainability,
          llmFeatures,
          highlightPrediction,
          highlightRecommendation,
          compositionFeatures,
          hookPrediction,
          semanticEvents,
          narrativeGraph,
          contextualMomentum,
          emotionalArc,
          thumbnailSelectionBreakdown,
          thumbnailSelectionFallback,
          ...clip
        }) => ({
          ...clip,
          downloadUrl: outputUrl ? `/clips/${clip.id}/download` : null,
          thumbnailUrl: clipThumbnailUrl ? `/clips/${clip.id}/thumbnail` : null,
          animatedThumbnailUrl: clipAnimatedThumbnailUrl
            ? `/clips/${clip.id}/animated-thumbnail`
            : null,
          hoverPreviewUrl: clipHoverPreviewUrl ? `/clips/${clip.id}/hover-preview` : null,
          storyboardFrameUrls: toSharedStoryboardFrameKeys(clipStoryboardFrameUrls).map(
            (_, i) => `/clips/${clip.id}/storyboard/${i}`,
          ),
          // Narrowed explicitly (not left as Prisma's opaque JsonValue) - an
          // un-narrowed Json field pulls Prisma's internal (unnameable)
          // runtime type into this method's inferred return type, which then
          // breaks declaration emit for every caller up the chain (VideosController's
          // findAll/findOne/retry).
          scores: toSharedClipScores(scores),
          facialEmotions: toSharedFacialEmotions(facialEmotions),
          sceneCutEvents: toSharedSceneCutEvents(sceneCutEvents),
          gestures: toSharedGestures(gestures),
          audioFeatures: toSharedAudioFeatures(audioFeatures),
          sceneFeatures: toSharedSceneFeatures(sceneFeatures),
          motionEnergy: toSharedMotionEnergy(motionEnergy),
          motionEnergyFeatures: toSharedMotionEnergyFeatures(motionEnergyFeatures),
          cameraMotion: toSharedCameraMotion(cameraMotion),
          cameraMotionFeatures: toSharedCameraMotionFeatures(cameraMotionFeatures),
          editingRhythmFeatures: toSharedEditingRhythmFeatures(editingRhythmFeatures),
          facialFeatures: toSharedFacialFeatures(facialFeatures),
          gestureFeatures: toSharedGestureFeatures(gestureFeatures),
          faceLandmarks: toSharedFaceLandmarks(faceLandmarks),
          faceLandmarkFeatures: toSharedFaceLandmarkFeatures(faceLandmarkFeatures),
          trackingQualityMetrics: toSharedTrackingQualityMetrics(trackingQualityMetrics),
          activeSpeakerSamples: toSharedActiveSpeakerSamples(activeSpeakerSamples),
          speakerFaceAssociations: toSharedSpeakerFaceAssociations(speakerFaceAssociations),
          lipSyncVerifications: toSharedLipSyncVerifications(lipSyncVerifications),
          speakerTimeline: toSharedSpeakerTimeline(speakerTimeline),
          speakerTimelineFeatures: toSharedSpeakerTimelineFeatures(speakerTimelineFeatures),
          speakerConfidenceScores: toSharedSpeakerConfidenceScores(speakerConfidenceScores),
          speakerEngagementScores: toSharedSpeakerEngagementScores(speakerEngagementScores),
          speakerImportanceScores: toSharedSpeakerImportanceScores(speakerImportanceScores),
          speakerHighlightMoments: toSharedSpeakerHighlightMoments(speakerHighlightMoments),
          ocrText: toSharedOcrText(ocrText),
          ocrTracks: toSharedOcrTracks(ocrTracks),
          ocrFeatures: toSharedOcrFeatures(ocrFeatures),
          objects: toSharedObjects(objects),
          objectTracks: toSharedObjectTracks(objectTracks),
          objectFeatures: toSharedObjectFeatures(objectFeatures),
          highlightBreakdown: toSharedHighlightBreakdown(highlightBreakdown),
          highlightExplainability: toSharedHighlightExplainability(highlightExplainability),
          llmFeatures: toSharedLlmFeatures(llmFeatures),
          highlightPrediction: toSharedHighlightPrediction(highlightPrediction),
          highlightRecommendation: toSharedHighlightRecommendation(highlightRecommendation),
          compositionFeatures: toSharedCompositionFeatures(compositionFeatures),
          hookPrediction: toSharedHookPrediction(hookPrediction),
          semanticEvents: toSharedSemanticEvents(semanticEvents),
          narrativeGraph: toSharedNarrativeGraph(narrativeGraph),
          contextualMomentum: toSharedContextualMomentum(contextualMomentum),
          emotionalArc: toSharedEmotionalArc(emotionalArc),
          thumbnailSelectionBreakdown: toSharedThumbnailSelectionBreakdown(
            thumbnailSelectionBreakdown,
          ),
          thumbnailSelectionFallback: thumbnailSelectionFallback as ThumbnailFallbackLevel | null,
          publishRecords: publishRecords.map(toSharedPublishRecord),
        }),
      ),
    };
  }
}
