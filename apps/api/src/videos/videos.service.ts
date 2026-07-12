import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  recordActivityEvent,
  recordVideoStatusEvent,
  updateVideoStatus,
  VideoStatus,
  type Prisma,
  type Video,
} from '@speedora/database';
import {
  filterSegmentsForClip,
  QueueName,
  TranscriptionProvider,
  type DetectClipsJobData,
  type ImportYoutubeJobData,
  type RenderClipJobData,
  type TranscribeJobData,
} from '@speedora/shared';
import { Queue } from 'bullmq';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { toSharedPublishRecord } from '../social/publish-record.util';
import { StorageService } from '../storage/storage.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly payments: PaymentsService,
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

    const { sourceUrl } = await this.storage.saveVideo(file);

    const video = await this.prisma.$transaction(async (tx) => {
      const created = await tx.video.create({
        data: {
          ownerId,
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
  ): Promise<Video> {
    if (provider === TranscriptionProvider.OPENAI) {
      const { available } = await this.payments.getAvailability(ownerId);
      if (!available) {
        throw new BadRequestException(NO_PREMIUM_CREDIT_MESSAGE);
      }
    }

    const video = await this.prisma.$transaction(async (tx) => {
      const created = await tx.video.create({
        data: {
          ownerId,
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
  async findAll(ownerId: string, { cursor, limit }: { cursor?: string; limit: number }) {
    const videos = await this.prisma.video.findMany({
      where: { ownerId },
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

    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }
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

    // Same "not found" for a missing video and someone else's video, so a
    // client can't use this endpoint to probe which video IDs exist.
    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return this.mapVideoWithClips(video);
  }

  // Used by GET /videos/:id/source (timeline editor's <video> preview) -
  // only needs the object key, not the full clips/status shape findOne()
  // returns.
  async findSourceOrThrow(id: string, requesterId: string): Promise<{ sourceUrl: string }> {
    const video = await this.prisma.video.findUnique({ where: { id } });

    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return { sourceUrl: video.sourceUrl };
  }

  // Permanently deletes a video, its clips/transcript/publish records (all
  // via onDelete: Cascade in the schema), and the objects they own in
  // storage (the source plus every rendered clip). Same ownership-based 404
  // as every other per-video endpoint so it can't be used to probe or delete
  // someone else's video. Storage cleanup is best-effort (see
  // StorageService.deleteObjects) - the DB row going away is what actually
  // makes the video "gone" from the user's perspective.
  async remove(id: string, requesterId: string): Promise<void> {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: { clips: { select: { outputUrl: true } } },
    });

    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    const storageKeys = [
      video.sourceUrl,
      ...video.clips.map((clip) => clip.outputUrl ?? ''),
    ].filter((key): key is string => key.length > 0);

    await this.prisma.video.delete({ where: { id } });
    await this.storage.deleteObjects(storageKeys);
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

    if (!video || video.ownerId !== requesterId) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return video.transcriptSegments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: segment.speaker ?? undefined,
      emotion: segment.emotion ?? undefined,
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
      ...rest
    } = video;
    return {
      ...rest,
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
          ...clip
        }) => ({
          ...clip,
          downloadUrl: outputUrl ? `/clips/${clip.id}/download` : null,
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
          publishRecords: publishRecords.map(toSharedPublishRecord),
        }),
      ),
    };
  }
}
