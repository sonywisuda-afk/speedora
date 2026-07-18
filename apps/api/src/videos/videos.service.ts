import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  recordActivityEvent,
  recordNotification,
  recordVideoStatusEvent,
  updateVideoStatus,
  VideoStatus,
  WorkspaceRole,
  type Prisma,
  type Video,
} from '@speedora/database';
import { buildClipMetadataReport, buildVideoReportData } from '@speedora/report-builder';
import type { ClipMetadataOutput, TimelineEvent, VideoReportData } from '@speedora/contracts';
import {
  filterSegmentsForClip,
  QueueName,
  TranscriptionProvider,
  type DetectClipsJobData,
  type ImportYoutubeJobData,
  type RenderClipJobData,
  type ThumbnailFallbackLevel,
  type TranscribeJobData,
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
import { buildVideoReportCsv, buildVideoReportInput } from './video-report.util';
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
  toSharedLipSyncVerifications,
  toSharedLlmFeatures,
  toSharedOcrFeatures,
  toSharedOcrText,
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

const CLIPS_WITH_PUBLISH_RECORDS = {
  orderBy: { viralityScore: 'desc' },
  include: { publishRecords: { include: { socialAccount: true } } },
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
    @InjectQueue(QueueName.TRANSCRIBE) private readonly transcribeQueue: Queue<TranscribeJobData>,
    @InjectQueue(QueueName.DETECT_CLIPS)
    private readonly detectClipsQueue: Queue<DetectClipsJobData>,
    @InjectQueue(QueueName.RENDER_CLIP) private readonly renderClipQueue: Queue<RenderClipJobData>,
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

    await this.transcribeQueue.add(QueueName.TRANSCRIBE, {
      videoId: video.id,
      sourceUrl: video.sourceUrl,
      provider,
    });

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
        },
      });
      await recordVideoStatusEvent(tx, created.id, created.status);
      return created;
    });

    if (provider === TranscriptionProvider.OPENAI) {
      await this.claimCreditOrRollback(ownerId, video.id);
    }

    await this.importYoutubeQueue.add(QueueName.IMPORT_YOUTUBE, {
      videoId: video.id,
      url,
      provider,
    });

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
    if (video.status !== VideoStatus.FAILED) {
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
      await updateVideoStatus(this.prisma, id, VideoStatus.IMPORTING, {
        data: { importProgress: 0 },
      });
      await this.importYoutubeQueue.add(QueueName.IMPORT_YOUTUBE, {
        videoId: id,
        url: video.importSourceUrl,
        provider: toSharedTranscriptionProvider(video.transcriptionProvider),
      });
    } else if (video.transcriptSegments.length === 0) {
      // transcribeProgress reset immediately (not left to wait for the job
      // itself to reset it) so a retry click doesn't briefly show a stale
      // progress value from the failed attempt before the worker picks the
      // job up.
      await updateVideoStatus(this.prisma, id, VideoStatus.UPLOADED, {
        data: { transcribeProgress: 0 },
      });
      await this.transcribeQueue.add(QueueName.TRANSCRIBE, {
        videoId: id,
        sourceUrl: video.sourceUrl,
        provider: toSharedTranscriptionProvider(video.transcriptionProvider),
      });
    } else if (video.clips.length === 0) {
      await updateVideoStatus(this.prisma, id, VideoStatus.TRANSCRIBED);
      await this.detectClipsQueue.add(QueueName.DETECT_CLIPS, {
        videoId: id,
        segments: video.transcriptSegments.map(toSharedTranscriptSegment),
      });
    } else {
      const unrendered = video.clips.filter((clip) => !clip.outputUrl);

      if (unrendered.length === 0) {
        // Nothing left to redo - every clip already has output. Shouldn't
        // normally happen (status only becomes FAILED from an active job's
        // catch block), but self-heal rather than error if it does.
        await updateVideoStatus(this.prisma, id, VideoStatus.RENDERED);
        return this.findOne(id, requesterId);
      }

      await updateVideoStatus(this.prisma, id, VideoStatus.CLIPS_DETECTED);
      await Promise.all(
        unrendered.map((clip) =>
          this.renderClipQueue.add(QueueName.RENDER_CLIP, {
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
            keywords: clip.keywords,
            scores: toSharedClipScores(clip.scores),
          }),
        ),
      );
    }

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

    return this.prisma.video.update({
      where: { id },
      data: {
        workspaceId: targetWorkspaceId,
        projectId: targetProjectId,
        folderId: targetFolderId,
      },
    });
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

    return video.transcriptSegments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: segment.speaker ?? undefined,
      emotion: segment.emotion ?? undefined,
    }));
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
