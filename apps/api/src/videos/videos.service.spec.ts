import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, VideoStatus } from '@speedora/database';
import {
  CaptionStyle,
  DETECT_CLIPS_RETRY_OPTIONS,
  GENERATE_MORE_CLIPS_RETRY_OPTIONS,
  IMPORT_YOUTUBE_RETRY_OPTIONS,
  PROBE_VIDEO_RETRY_OPTIONS,
  QueueName,
  RENDER_CLIP_RETRY_OPTIONS,
  TRANSCRIBE_RETRY_OPTIONS,
  TranscriptionProvider,
} from '@speedora/shared';
import type { Queue } from 'bullmq';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationDeliveryProducer } from '../queue/notification-delivery.producer';
import type { NotificationPublisherService } from '../redis-pubsub/notification-publisher.service';
import type { StorageService } from '../storage/storage.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  let prisma: {
    video: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    // Generate More Clips roadmap (Phase C) - generateMore()'s "video not
    // currently mid-render" concurrency guard.
    clip: { findFirst: jest.Mock };
    videoStatusEvent: { create: jest.Mock; findMany: jest.Mock };
    activityEvent: { create: jest.Mock };
    notification: { create: jest.Mock };
    notificationPreference: { findUnique: jest.Mock };
    project: { findUnique: jest.Mock };
    folder: { findUnique: jest.Mock };
    auditLogEntry: { create: jest.Mock };
    transcriptSegment: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    transcriptTranslationRequest: { count: jest.Mock; create: jest.Mock };
    // Workspace-level Brand Kit roadmap (P3g).
    user: { findUniqueOrThrow: jest.Mock };
    workspace: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let workspaceAccess: {
    assertMinRole: jest.Mock;
    assertVideoAccess: jest.Mock;
    getPersonalWorkspaceId: jest.Mock;
    getRole: jest.Mock;
  };
  let storage: { saveVideo: jest.Mock; deleteObjects: jest.Mock };
  let payments: { getAvailability: jest.Mock; consumeCredit: jest.Mock };
  let notificationPublisher: { publish: jest.Mock };
  let notificationDeliveryProducer: { enqueue: jest.Mock };
  let importYoutubeQueue: { add: jest.Mock };
  let probeVideoQueue: { add: jest.Mock };
  let transcribeQueue: { add: jest.Mock };
  let detectClipsQueue: { add: jest.Mock };
  let renderClipQueue: { add: jest.Mock };
  let translateTranscriptQueue: { add: jest.Mock };
  let generateMoreClipsQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      video: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      // Generate More Clips roadmap (Phase C) - defaults to "no clip
      // currently mid-render"; individual tests override to exercise the
      // concurrency-guard rejection path.
      clip: { findFirst: jest.fn().mockResolvedValue(null) },
      // Dashboard Improvement Sprint Phase B ("View All" video processing
      // history) - findHistory's processingTime/topScore sort branch.
      $queryRaw: jest.fn(),
      videoStatusEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      activityEvent: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      project: { findUnique: jest.fn() },
      folder: { findUnique: jest.fn() },
      auditLogEntry: { create: jest.fn().mockResolvedValue({}) },
      // Subtitle Studio roadmap (P2).
      transcriptSegment: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      transcriptTranslationRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
      // Workspace-level Brand Kit roadmap (P3g) - workspace defaults to
      // personal (mergeBrandKitFields short-circuits to the owner's fields
      // untouched), same "existing tests keep working unchanged" reasoning
      // as ClipsService's own spec.
      user: { findUniqueOrThrow: jest.fn() },
      workspace: { findUniqueOrThrow: jest.fn().mockResolvedValue({ isPersonal: true }) },
      // Supports both call shapes used by VideosService: the interactive
      // form (upload/importFromYoutube, which need the just-created video's
      // id before writing its first VideoStatusEvent) and the array form
      // (updateVideoStatus(), used by retry()) - see
      // @speedora/database's video-status.ts.
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg as Promise<unknown>[]),
    );
    // Default: every access check succeeds (an OWNER of a personal
    // workspace 'workspace-1') - WorkspaceAccessService has its own
    // dedicated spec covering role-rank logic, so these tests only need to
    // verify VideosService's own orchestration around it. Individual tests
    // override assertMinRole/assertVideoAccess to reject where they need to
    // exercise the "no access" path.
    workspaceAccess = {
      assertMinRole: jest.fn().mockResolvedValue('OWNER'),
      assertVideoAccess: jest.fn(),
      getPersonalWorkspaceId: jest.fn().mockResolvedValue('workspace-1'),
      getRole: jest.fn().mockResolvedValue('OWNER'),
    };
    storage = { saveVideo: jest.fn(), deleteObjects: jest.fn().mockResolvedValue(undefined) };
    payments = {
      getAvailability: jest.fn().mockResolvedValue({ available: true }),
      consumeCredit: jest.fn().mockResolvedValue(true),
    };
    notificationPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    notificationDeliveryProducer = { enqueue: jest.fn().mockResolvedValue(undefined) };
    importYoutubeQueue = { add: jest.fn() };
    probeVideoQueue = { add: jest.fn() };
    transcribeQueue = { add: jest.fn() };
    detectClipsQueue = { add: jest.fn() };
    renderClipQueue = { add: jest.fn() };
    translateTranscriptQueue = { add: jest.fn() };
    generateMoreClipsQueue = { add: jest.fn() };
    service = new VideosService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      payments as unknown as PaymentsService,
      workspaceAccess as unknown as WorkspaceAccessService,
      notificationPublisher as unknown as NotificationPublisherService,
      notificationDeliveryProducer as unknown as NotificationDeliveryProducer,
      importYoutubeQueue as unknown as Queue,
      probeVideoQueue as unknown as Queue,
      transcribeQueue as unknown as Queue,
      detectClipsQueue as unknown as Queue,
      renderClipQueue as unknown as Queue,
      translateTranscriptQueue as unknown as Queue,
      generateMoreClipsQueue as unknown as Queue,
    );
  });

  describe('upload', () => {
    it('saves the file to storage, creates the video row (GROQ), and enqueues probe-video', async () => {
      storage.saveVideo.mockResolvedValue({ sourceUrl: 'videos/abc.mp4' });
      const createdVideo = {
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        title: 'my-video.mp4',
        status: VideoStatus.UPLOADED,
      };
      prisma.video.create.mockResolvedValue(createdVideo);
      const file = {
        buffer: Buffer.from('xy'),
        originalname: 'my-video.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      const result = await service.upload('user-1', file, TranscriptionProvider.GROQ);

      expect(storage.saveVideo).toHaveBeenCalledWith(file);
      expect(prisma.video.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'user-1',
          workspaceId: 'workspace-1',
          sourceUrl: 'videos/abc.mp4',
          transcriptionProvider: TranscriptionProvider.GROQ,
          title: 'my-video.mp4',
          sourceSizeBytes: 2,
          processingOptions: Prisma.JsonNull,
        },
      });
      // Fase 3 (DB+JSON-contract roadmap) - the video's first status event,
      // written in the same transaction as its creation.
      expect(prisma.videoStatusEvent.create).toHaveBeenCalledWith({
        data: { videoId: 'video-1', toStatus: VideoStatus.UPLOADED, errorMessage: null },
      });
      // Sprint 1-2 (Dashboard Redesign) - Activity Timeline entry. title/
      // description are denormalized by recordActivityEvent itself
      // (Activity Timeline v2) - see ActivityEvent.title's own schema
      // comment.
      expect(prisma.activityEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'VIDEO_UPLOADED',
          videoId: 'video-1',
          clipId: null,
          metadata: { title: 'my-video.mp4' },
          title: 'Video diunggah',
          description: 'my-video.mp4',
        },
      });
      // Notification Center Sprint 4A - Upload Complete.
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'UPLOAD_COMPLETE',
          category: 'UPLOAD',
          priority: 'INFO',
          title: 'Upload selesai',
          body: 'Video "my-video.mp4" berhasil diunggah dan sedang diproses.',
          videoId: 'video-1',
          clipId: null,
          metadata: undefined,
        },
      });
      // Milestone 04c - Upload Complete pushed over SSE in realtime.
      expect(notificationPublisher.publish).toHaveBeenCalledWith({
        userId: 'user-1',
        notificationId: 'notif-1',
        type: 'UPLOAD_COMPLETE',
      });
      expect(payments.getAvailability).not.toHaveBeenCalled();
      expect(payments.consumeCredit).not.toHaveBeenCalled();
      expect(probeVideoQueue.add).toHaveBeenCalledWith(
        QueueName.PROBE_VIDEO,
        { videoId: 'video-1', sourceUrl: 'videos/abc.mp4' },
        PROBE_VIDEO_RETRY_OPTIONS,
      );
      expect(result).toEqual(createdVideo);
    });

    it('consumes a premium credit and proceeds when provider is OPENAI and a credit is available', async () => {
      storage.saveVideo.mockResolvedValue({ sourceUrl: 'videos/abc.mp4' });
      const createdVideo = { id: 'video-1', ownerId: 'user-1', sourceUrl: 'videos/abc.mp4' };
      prisma.video.create.mockResolvedValue(createdVideo);
      const file = { buffer: Buffer.from('x'), mimetype: 'video/mp4' } as Express.Multer.File;

      const result = await service.upload('user-1', file, TranscriptionProvider.OPENAI);

      expect(payments.getAvailability).toHaveBeenCalledWith('user-1');
      expect(payments.consumeCredit).toHaveBeenCalledWith('user-1', 'video-1');
      expect(prisma.video.delete).not.toHaveBeenCalled();
      expect(probeVideoQueue.add).toHaveBeenCalledWith(
        QueueName.PROBE_VIDEO,
        { videoId: 'video-1', sourceUrl: 'videos/abc.mp4' },
        PROBE_VIDEO_RETRY_OPTIONS,
      );
      expect(result).toEqual(createdVideo);
    });

    it('rejects with 400 before touching storage when OPENAI is requested with no available credit', async () => {
      payments.getAvailability.mockResolvedValue({ available: false });
      const file = { buffer: Buffer.from('x'), mimetype: 'video/mp4' } as Express.Multer.File;

      await expect(service.upload('user-1', file, TranscriptionProvider.OPENAI)).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.saveVideo).not.toHaveBeenCalled();
      expect(prisma.video.create).not.toHaveBeenCalled();
    });

    it('rolls back (deletes the video + storage object) when consumeCredit loses a race', async () => {
      storage.saveVideo.mockResolvedValue({ sourceUrl: 'videos/abc.mp4' });
      prisma.video.create.mockResolvedValue({ id: 'video-1', ownerId: 'user-1' });
      payments.consumeCredit.mockResolvedValue(false);
      const file = { buffer: Buffer.from('x'), mimetype: 'video/mp4' } as Express.Multer.File;

      await expect(service.upload('user-1', file, TranscriptionProvider.OPENAI)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'video-1' } });
      expect(storage.deleteObjects).toHaveBeenCalledWith(['videos/abc.mp4']);
      expect(probeVideoQueue.add).not.toHaveBeenCalled();
    });

    // Pre-Processing Settings roadmap (Phase 0/1).
    it('persists a submitted processingOptions snapshot onto the created video', async () => {
      storage.saveVideo.mockResolvedValue({ sourceUrl: 'videos/abc.mp4' });
      prisma.video.create.mockResolvedValue({ id: 'video-1', ownerId: 'user-1' });
      const file = { buffer: Buffer.from('x'), mimetype: 'video/mp4' } as Express.Multer.File;
      const processingOptions = {
        version: 1 as const,
        project: { name: 'My Project', tags: ['podcast'] },
        clipGeneration: {
          clipCount: 5 as const,
          minClipDurationSeconds: 30,
          maxClipDurationSeconds: 90,
        },
        subtitle: {
          captionStyle: CaptionStyle.KARAOKE,
          speakerColorCaptions: true,
          fontFamily: null,
        },
        export: { qualityPreset: 'maximum_quality' as const },
        sceneAnalysis: {
          detectSceneCuts: true,
          detectMotionEnergy: true,
          detectCameraMotion: true,
        },
        highlightFocus: { intents: [], confidenceThreshold: null },
        smartCrop: { zoomInFraction: null },
        brandKit: { applyBrandKit: true, templateId: null },
        seo: { autoGeneratePlatformCopy: false, platforms: [] },
        publishing: { autoPublish: false, socialAccountIds: [], scheduledAt: null },
        thumbnail: { preferredSignals: [] },
      };

      await service.upload(
        'user-1',
        file,
        TranscriptionProvider.GROQ,
        undefined,
        processingOptions,
      );

      expect(prisma.video.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ processingOptions }) }),
      );
    });
  });

  describe('importFromYoutube', () => {
    it('creates an IMPORTING video (GROQ) with the url saved and enqueues import-youtube', async () => {
      const createdVideo = {
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: '',
        importSourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        status: VideoStatus.IMPORTING,
      };
      prisma.video.create.mockResolvedValue(createdVideo);

      const result = await service.importFromYoutube(
        'user-1',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        TranscriptionProvider.GROQ,
      );

      expect(prisma.video.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'user-1',
          workspaceId: 'workspace-1',
          sourceUrl: '',
          importSourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          status: VideoStatus.IMPORTING,
          transcriptionProvider: TranscriptionProvider.GROQ,
          processingOptions: Prisma.JsonNull,
        },
      });
      expect(prisma.videoStatusEvent.create).toHaveBeenCalledWith({
        data: { videoId: 'video-1', toStatus: VideoStatus.IMPORTING, errorMessage: null },
      });
      expect(payments.getAvailability).not.toHaveBeenCalled();
      expect(importYoutubeQueue.add).toHaveBeenCalledWith(
        QueueName.IMPORT_YOUTUBE,
        {
          videoId: 'video-1',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        },
        IMPORT_YOUTUBE_RETRY_OPTIONS,
      );
      // Sprint 1-2 (Dashboard Redesign) - Activity Timeline entry. No title
      // metadata yet (unlike upload() above) - the YouTube title isn't known
      // until import-youtube.worker.ts actually runs, so describeActivityEvent
      // falls back to its generic "video tanpa judul" description (Activity
      // Timeline v2 - see recordActivityEvent's own comment).
      expect(prisma.activityEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'VIDEO_UPLOADED',
          videoId: 'video-1',
          clipId: null,
          metadata: undefined,
          title: 'Video diunggah',
          description: 'video tanpa judul',
        },
      });
      // Notification Center Sprint 4A - Upload Complete (YouTube import path).
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'UPLOAD_COMPLETE',
          category: 'UPLOAD',
          priority: 'INFO',
          title: 'Import YouTube dimulai',
          body: 'Video dari YouTube Anda sedang diunduh dan diproses.',
          videoId: 'video-1',
          clipId: null,
          metadata: undefined,
        },
      });
      // Milestone 04c - Upload Complete pushed over SSE in realtime.
      expect(notificationPublisher.publish).toHaveBeenCalledWith({
        userId: 'user-1',
        notificationId: 'notif-1',
        type: 'UPLOAD_COMPLETE',
      });
      expect(result).toEqual(createdVideo);
    });

    it('rejects with 400 before creating a video when OPENAI is requested with no available credit', async () => {
      payments.getAvailability.mockResolvedValue({ available: false });

      await expect(
        service.importFromYoutube(
          'user-1',
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          TranscriptionProvider.OPENAI,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.video.create).not.toHaveBeenCalled();
    });

    it('consumes a premium credit and proceeds when provider is OPENAI and a credit is available', async () => {
      const createdVideo = { id: 'video-1', ownerId: 'user-1', sourceUrl: '' };
      prisma.video.create.mockResolvedValue(createdVideo);

      await service.importFromYoutube(
        'user-1',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        TranscriptionProvider.OPENAI,
      );

      expect(payments.consumeCredit).toHaveBeenCalledWith('user-1', 'video-1');
      expect(importYoutubeQueue.add).toHaveBeenCalledWith(
        QueueName.IMPORT_YOUTUBE,
        {
          videoId: 'video-1',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          provider: TranscriptionProvider.OPENAI,
        },
        IMPORT_YOUTUBE_RETRY_OPTIONS,
      );
    });

    it('rolls back (deletes the video) when consumeCredit loses a race', async () => {
      prisma.video.create.mockResolvedValue({ id: 'video-1', ownerId: 'user-1' });
      payments.consumeCredit.mockResolvedValue(false);

      await expect(
        service.importFromYoutube(
          'user-1',
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          TranscriptionProvider.OPENAI,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'video-1' } });
      expect(importYoutubeQueue.add).not.toHaveBeenCalled();
    });

    // Pre-Processing Settings roadmap (Phase 0/1).
    it('persists a submitted processingOptions snapshot onto the created video', async () => {
      prisma.video.create.mockResolvedValue({ id: 'video-1', ownerId: 'user-1' });
      const processingOptions = {
        version: 1 as const,
        project: { name: null, tags: [] },
        clipGeneration: {
          clipCount: 'unlimited' as const,
          minClipDurationSeconds: null,
          maxClipDurationSeconds: null,
        },
        subtitle: {
          captionStyle: CaptionStyle.DEFAULT,
          speakerColorCaptions: false,
          fontFamily: null,
        },
        export: { qualityPreset: 'small_size' as const },
        sceneAnalysis: {
          detectSceneCuts: true,
          detectMotionEnergy: true,
          detectCameraMotion: true,
        },
        highlightFocus: { intents: [], confidenceThreshold: null },
        smartCrop: { zoomInFraction: null },
        brandKit: { applyBrandKit: true, templateId: null },
        seo: { autoGeneratePlatformCopy: false, platforms: [] },
        publishing: { autoPublish: false, socialAccountIds: [], scheduledAt: null },
        thumbnail: { preferredSignals: [] },
      };

      await service.importFromYoutube(
        'user-1',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        TranscriptionProvider.GROQ,
        undefined,
        processingOptions,
      );

      expect(prisma.video.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ processingOptions }) }),
      );
    });
  });

  describe('findAll', () => {
    it('maps each clip to a downloadUrl and strips the raw outputUrl', async () => {
      prisma.video.findMany.mockResolvedValue([
        {
          id: 'video-1',
          ownerId: 'user-1',
          clips: [
            {
              id: 'clip-1',
              outputUrl: 'renders/clip-1.mp4',
              viralityScore: 90,
              publishRecords: [],
            },
            { id: 'clip-2', outputUrl: null, viralityScore: 40, publishRecords: [] },
          ],
        },
      ]);

      const result = await service.findAll('user-1', { limit: 20 });

      expect(prisma.video.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        include: {
          clips: {
            orderBy: { viralityScore: 'desc' },
            include: { publishRecords: { include: { socialAccount: true } } },
          },
        },
      });
      expect(result.nextCursor).toBeNull();
      expect(result.videos[0].clips).toEqual([
        {
          id: 'clip-1',
          viralityScore: 90,
          downloadUrl: '/clips/clip-1/download',
          thumbnailUrl: null,
          animatedThumbnailUrl: null,
          hoverPreviewUrl: null,
          storyboardFrameUrls: [],
          thumbnailSelectionBreakdown: null,
          scores: null,
          facialEmotions: null,
          sceneCutEvents: null,
          motionEnergy: [],
          motionEnergyFeatures: null,
          cameraMotion: null,
          cameraMotionFeatures: null,
          editingRhythmFeatures: null,
          audioFeatures: null,
          sceneFeatures: null,
          facialFeatures: null,
          gestures: null,
          gestureFeatures: null,
          faceLandmarks: null,
          faceLandmarkFeatures: null,
          trackingQualityMetrics: null,
          activeSpeakerSamples: null,
          speakerFaceAssociations: null,
          lipSyncVerifications: null,
          speakerTimeline: null,
          speakerTimelineFeatures: null,
          speakerConfidenceScores: null,
          speakerEngagementScores: null,
          speakerImportanceScores: null,
          speakerHighlightMoments: null,
          ocrText: null,
          ocrTracks: null,
          ocrFeatures: null,
          objects: null,
          objectTracks: null,
          objectFeatures: null,
          highlightBreakdown: [],
          highlightExplainability: { topFactors: [] },
          llmFeatures: null,
          highlightPrediction: null,
          highlightRecommendation: null,
          compositionFeatures: null,
          hookPrediction: null,
          semanticEvents: null,
          narrativeGraph: null,
          contextualMomentum: null,
          emotionalArc: null,
          multiSpeakerBreakdown: null,
          viralityPrediction: null,
          retentionCurveInsights: null,
          multimodalReasoning: null,
          publishRecords: [],
        },
        {
          id: 'clip-2',
          viralityScore: 40,
          downloadUrl: null,
          thumbnailUrl: null,
          animatedThumbnailUrl: null,
          hoverPreviewUrl: null,
          storyboardFrameUrls: [],
          thumbnailSelectionBreakdown: null,
          scores: null,
          facialEmotions: null,
          sceneCutEvents: null,
          motionEnergy: [],
          motionEnergyFeatures: null,
          cameraMotion: null,
          cameraMotionFeatures: null,
          editingRhythmFeatures: null,
          audioFeatures: null,
          sceneFeatures: null,
          facialFeatures: null,
          gestures: null,
          gestureFeatures: null,
          faceLandmarks: null,
          faceLandmarkFeatures: null,
          trackingQualityMetrics: null,
          activeSpeakerSamples: null,
          speakerFaceAssociations: null,
          lipSyncVerifications: null,
          speakerTimeline: null,
          speakerTimelineFeatures: null,
          speakerConfidenceScores: null,
          speakerEngagementScores: null,
          speakerImportanceScores: null,
          speakerHighlightMoments: null,
          ocrText: null,
          ocrTracks: null,
          ocrFeatures: null,
          objects: null,
          objectTracks: null,
          objectFeatures: null,
          highlightBreakdown: [],
          highlightExplainability: { topFactors: [] },
          llmFeatures: null,
          highlightPrediction: null,
          highlightRecommendation: null,
          compositionFeatures: null,
          hookPrediction: null,
          semanticEvents: null,
          narrativeGraph: null,
          contextualMomentum: null,
          emotionalArc: null,
          multiSpeakerBreakdown: null,
          viralityPrediction: null,
          retentionCurveInsights: null,
          multimodalReasoning: null,
          publishRecords: [],
        },
      ]);
      expect(result.videos[0].clips[0]).not.toHaveProperty('outputUrl');
    });

    it('passes thumbnailBlurDataUrl through unchanged at both video and clip level', async () => {
      prisma.video.findMany.mockResolvedValue([
        {
          id: 'video-1',
          ownerId: 'user-1',
          thumbnailBlurDataUrl: 'data:image/webp;base64,dmlkZW8=',
          clips: [
            {
              id: 'clip-1',
              outputUrl: null,
              viralityScore: 90,
              thumbnailBlurDataUrl: 'data:image/webp;base64,Y2xpcA==',
              publishRecords: [],
            },
          ],
        },
      ]);

      const result = await service.findAll('user-1', { limit: 20 });

      expect(result.videos[0].thumbnailBlurDataUrl).toBe('data:image/webp;base64,dmlkZW8=');
      expect(result.videos[0].clips[0].thumbnailBlurDataUrl).toBe(
        'data:image/webp;base64,Y2xpcA==',
      );
    });

    it('resolves the workspace from projectId and filters by both (Sprint 5A)', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'ws-1' });
      prisma.video.findMany.mockResolvedValue([]);

      await service.findAll('user-1', { limit: 20, projectId: 'project-1' });

      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: 'project-1' } });
      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
      expect(prisma.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: 'ws-1', projectId: 'project-1' } }),
      );
    });

    it('also filters by folderId when given alongside projectId', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'ws-1' });
      prisma.video.findMany.mockResolvedValue([]);

      await service.findAll('user-1', {
        limit: 20,
        projectId: 'project-1',
        folderId: 'folder-1',
      });

      expect(prisma.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1', projectId: 'project-1', folderId: 'folder-1' },
        }),
      );
    });

    it('throws NotFoundException when projectId does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.findAll('user-1', { limit: 20, projectId: 'missing' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.video.findMany).not.toHaveBeenCalled();
    });

    it('paginates via cursor and reports nextCursor when there are more rows than the limit', async () => {
      prisma.video.findMany.mockResolvedValue([
        { id: 'video-3', ownerId: 'user-1', clips: [] },
        { id: 'video-2', ownerId: 'user-1', clips: [] },
      ]);

      const result = await service.findAll('user-1', { cursor: 'video-4', limit: 1 });

      expect(prisma.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'video-4' }, skip: 1, take: 2 }),
      );
      expect(result.videos.map((v) => v.id)).toEqual(['video-3']);
      expect(result.nextCursor).toBe('video-3');
    });
  });

  // Dashboard Improvement Sprint Phase B ("View All" video processing
  // history) - a separate method/endpoint from findAll (see
  // VideosService.findHistory's own comment), split into two pagination
  // branches. newest/oldest reuse findAll's Prisma findMany path; the two
  // computed sorts (processingTime/topScore) go through prisma.$queryRaw.
  describe('findHistory', () => {
    function rawRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'video-1',
        title: 'My Video',
        status: VideoStatus.RENDERED,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        ownerId: 'user-1',
        workspaceId: 'workspace-1',
        topClipScore: 88,
        clipCount: 3,
        processingTimeSeconds: 120,
        ...overrides,
      };
    }

    describe('sortBy newest/oldest (Prisma path)', () => {
      it('defaults to newest and resolves the personal workspace when none is given', async () => {
        prisma.video.findMany.mockResolvedValue([]);

        await service.findHistory('user-1', { limit: 20 });

        expect(workspaceAccess.getPersonalWorkspaceId).toHaveBeenCalledWith('user-1');
        expect(prisma.video.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { workspaceId: 'workspace-1' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 21,
          }),
        );
      });

      it('sortBy oldest flips the orderBy direction', async () => {
        prisma.video.findMany.mockResolvedValue([]);

        await service.findHistory('user-1', { limit: 20, sortBy: 'oldest' });

        expect(prisma.video.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        );
      });

      it('applies ownerId, status, search, and date-range filters together', async () => {
        prisma.video.findMany.mockResolvedValue([]);

        await service.findHistory('user-1', {
          limit: 20,
          workspaceId: 'ws-1',
          ownerId: 'owner-2',
          status: 'FAILED',
          search: 'zoo',
          dateFrom: new Date('2026-01-01T00:00:00.000Z'),
          dateTo: new Date('2026-02-01T00:00:00.000Z'),
        });

        expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
        expect(prisma.video.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              workspaceId: 'ws-1',
              ownerId: 'owner-2',
              status: { in: [VideoStatus.FAILED] },
              title: { contains: 'zoo', mode: 'insensitive' },
              createdAt: {
                gte: new Date('2026-01-01T00:00:00.000Z'),
                // PR #37 review fix - dateTo is shifted to the exclusive
                // start of the NEXT day (see endOfDayExclusive), compared
                // with `lt` not `lte`, so the entire selected end day is
                // actually included.
                lt: new Date('2026-02-02T00:00:00.000Z'),
              },
            },
          }),
        );
      });

      // PR #37 review fix regression test - dateTo previously compared with
      // `lte` against midnight of the selected day, excluding everything
      // created later that same day. This pins the corrected behavior.
      it('dateTo includes the entire selected day, not just its first instant', async () => {
        prisma.video.findMany.mockResolvedValue([]);

        await service.findHistory('user-1', {
          limit: 20,
          dateTo: new Date('2026-02-01T00:00:00.000Z'),
        });

        expect(prisma.video.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              createdAt: { lt: new Date('2026-02-02T00:00:00.000Z') },
            }),
          }),
        );
      });

      it('maps status RUNNING to every non-terminal VideoStatus value', async () => {
        prisma.video.findMany.mockResolvedValue([]);

        await service.findHistory('user-1', { limit: 20, status: 'RUNNING' });

        expect(prisma.video.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: {
                in: [
                  VideoStatus.IMPORTING,
                  VideoStatus.UPLOADED,
                  VideoStatus.PENDING_SETTINGS,
                  VideoStatus.TRANSCRIBED,
                  VideoStatus.CLIPS_DETECTED,
                ],
              },
            }),
          }),
        );
      });

      it('computes processingTimeSeconds as the first->last status-event span for a terminal video', async () => {
        prisma.video.findMany.mockResolvedValue([
          {
            id: 'video-1',
            title: 'Done',
            status: VideoStatus.RENDERED,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            ownerId: 'user-1',
            workspaceId: 'workspace-1',
            clips: [{ viralityScore: 77 }],
            _count: { clips: 1 },
            statusEvents: [
              { createdAt: new Date('2026-07-01T00:00:00.000Z') },
              { createdAt: new Date('2026-07-01T00:02:00.000Z') },
            ],
          },
        ]);

        const result = await service.findHistory('user-1', { limit: 20 });

        expect(result.videos[0]).toMatchObject({
          processingTimeSeconds: 120,
          topClipScore: 77,
          clipCount: 1,
        });
      });

      it('leaves processingTimeSeconds null for a non-terminal video even with >=2 status events', async () => {
        prisma.video.findMany.mockResolvedValue([
          {
            id: 'video-1',
            title: 'In progress',
            status: VideoStatus.TRANSCRIBED,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            ownerId: 'user-1',
            workspaceId: 'workspace-1',
            clips: [],
            _count: { clips: 0 },
            statusEvents: [
              { createdAt: new Date('2026-07-01T00:00:00.000Z') },
              { createdAt: new Date('2026-07-01T00:02:00.000Z') },
            ],
          },
        ]);

        const result = await service.findHistory('user-1', { limit: 20 });

        expect(result.videos[0].processingTimeSeconds).toBeNull();
        expect(result.videos[0].topClipScore).toBeNull();
      });

      it('leaves processingTimeSeconds null for a terminal video with fewer than 2 status events', async () => {
        prisma.video.findMany.mockResolvedValue([
          {
            id: 'video-1',
            title: 'Failed fast',
            status: VideoStatus.FAILED,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            ownerId: 'user-1',
            workspaceId: 'workspace-1',
            clips: [],
            _count: { clips: 0 },
            statusEvents: [{ createdAt: new Date('2026-07-01T00:00:00.000Z') }],
          },
        ]);

        const result = await service.findHistory('user-1', { limit: 20 });

        expect(result.videos[0].processingTimeSeconds).toBeNull();
      });

      it('returns cursor-mode pagination fields (page/totalPages/totalCount null)', async () => {
        const created = new Date('2026-07-01T00:00:00.000Z');
        prisma.video.findMany.mockResolvedValue([
          {
            id: 'video-2',
            ownerId: 'user-1',
            createdAt: created,
            clips: [],
            _count: { clips: 0 },
            statusEvents: [],
          },
          {
            id: 'video-1',
            ownerId: 'user-1',
            createdAt: created,
            clips: [],
            _count: { clips: 0 },
            statusEvents: [],
          },
        ]);

        const result = await service.findHistory('user-1', { limit: 1 });

        expect(result.nextCursor).toBe('video-2');
        expect(result.page).toBeNull();
        expect(result.totalPages).toBeNull();
        expect(result.totalCount).toBeNull();
      });
    });

    describe('sortBy processingTime/topScore (raw SQL path)', () => {
      it('returns page-mode pagination fields (nextCursor null) from $queryRaw results', async () => {
        prisma.$queryRaw
          .mockResolvedValueOnce([rawRow()])
          .mockResolvedValueOnce([{ count: BigInt(45) }]);

        const result = await service.findHistory('user-1', {
          limit: 20,
          sortBy: 'topScore',
          page: 2,
        });

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        expect(result.sortBy).toBe('topScore');
        expect(result.nextCursor).toBeNull();
        expect(result.page).toBe(2);
        expect(result.totalCount).toBe(45);
        expect(result.totalPages).toBe(3); // ceil(45 / 20)
        expect(result.videos[0]).toMatchObject({
          id: 'video-1',
          topClipScore: 88,
          clipCount: 3,
          processingTimeSeconds: 120,
        });
      });

      it('falls back to page 1 for an invalid/missing page number', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: BigInt(0) }]);

        const result = await service.findHistory('user-1', {
          limit: 20,
          sortBy: 'processingTime',
          page: 0,
        });

        expect(result.page).toBe(1);
      });

      it('resolves an explicit workspaceId the same way as the Prisma path', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: BigInt(0) }]);

        await service.findHistory('user-1', { limit: 20, sortBy: 'topScore', workspaceId: 'ws-1' });

        expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
      });
    });
  });

  describe('findOne', () => {
    it('returns the video when it belongs to the requester', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        clips: [],
      });

      const result = await service.findOne('video-1', 'user-1');

      expect(result.id).toBe('video-1');
    });

    it('throws NotFoundException when the video does not exist', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        workspaceId: 'ws-other',
        clips: [],
      });
      workspaceAccess.assertMinRole.mockRejectedValue(new NotFoundException());

      await expect(service.findOne('video-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findSourceOrThrow', () => {
    it('returns just the sourceUrl when the requester has access', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        sourceUrl: 'videos/abc.mp4',
      });

      const result = await service.findSourceOrThrow('video-1', 'user-1');

      expect(result).toEqual({ sourceUrl: 'videos/abc.mp4' });
    });

    it('throws NotFoundException when the video does not exist or the requester has no access', async () => {
      workspaceAccess.assertVideoAccess.mockRejectedValue(new NotFoundException());

      await expect(service.findSourceOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findThumbnailOrThrow', () => {
    it('returns just the thumbnailUrl when the requester has access', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        thumbnailUrl: 'thumbnails/video-1.jpg',
      });

      const result = await service.findThumbnailOrThrow('video-1', 'user-1');

      expect(result).toEqual({ thumbnailUrl: 'thumbnails/video-1.jpg' });
    });

    it('returns a null thumbnailUrl (not a throw) when extraction has not produced one yet', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        thumbnailUrl: null,
      });

      const result = await service.findThumbnailOrThrow('video-1', 'user-1');

      expect(result).toEqual({ thumbnailUrl: null });
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      workspaceAccess.assertVideoAccess.mockRejectedValue(new NotFoundException());

      await expect(service.findThumbnailOrThrow('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAnimatedThumbnailOrThrow', () => {
    it('returns just the animatedThumbnailUrl when the requester has access', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        animatedThumbnailUrl: 'animated-thumbnails/video-1.webp',
      });

      const result = await service.findAnimatedThumbnailOrThrow('video-1', 'user-1');

      expect(result).toEqual({ animatedThumbnailUrl: 'animated-thumbnails/video-1.webp' });
    });

    it('returns a null animatedThumbnailUrl (not a throw) when extraction has not produced one yet', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        animatedThumbnailUrl: null,
      });

      const result = await service.findAnimatedThumbnailOrThrow('video-1', 'user-1');

      expect(result).toEqual({ animatedThumbnailUrl: null });
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      workspaceAccess.assertVideoAccess.mockRejectedValue(new NotFoundException());

      await expect(service.findAnimatedThumbnailOrThrow('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findHoverPreviewOrThrow', () => {
    it('returns just the hoverPreviewUrl when the requester has access', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        hoverPreviewUrl: 'hover-previews/video-1.webp',
      });

      const result = await service.findHoverPreviewOrThrow('video-1', 'user-1');

      expect(result).toEqual({ hoverPreviewUrl: 'hover-previews/video-1.webp' });
    });

    it('returns a null hoverPreviewUrl (not a throw) when extraction has not produced one yet', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        hoverPreviewUrl: null,
      });

      const result = await service.findHoverPreviewOrThrow('video-1', 'user-1');

      expect(result).toEqual({ hoverPreviewUrl: null });
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      workspaceAccess.assertVideoAccess.mockRejectedValue(new NotFoundException());

      await expect(service.findHoverPreviewOrThrow('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findStoryboardFrameOrThrow', () => {
    it('returns the raw key at the requested index', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        storyboardFrameUrls: ['storyboards/video-1-0.webp', 'storyboards/video-1-1.webp'],
      });

      const result = await service.findStoryboardFrameOrThrow('video-1', 'user-1', 1);

      expect(result).toEqual({ frameKey: 'storyboards/video-1-1.webp' });
    });

    it('returns a null frameKey (not a throw) when the index is out of range', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        storyboardFrameUrls: ['storyboards/video-1-0.webp'],
      });

      const result = await service.findStoryboardFrameOrThrow('video-1', 'user-1', 5);

      expect(result).toEqual({ frameKey: null });
    });

    it('returns a null frameKey when no storyboard has been extracted yet', async () => {
      workspaceAccess.assertVideoAccess.mockResolvedValue({
        id: 'video-1',
        storyboardFrameUrls: null,
      });

      const result = await service.findStoryboardFrameOrThrow('video-1', 'user-1', 0);

      expect(result).toEqual({ frameKey: null });
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      workspaceAccess.assertVideoAccess.mockRejectedValue(new NotFoundException());

      await expect(service.findStoryboardFrameOrThrow('video-1', 'user-1', 0)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findTranscriptOrThrow', () => {
    it('returns segments mapped to the shared TranscriptSegment shape, ordered by start', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        transcriptSegments: [
          { start: 0, end: 5, text: 'hi', speaker: null, emotion: null },
          { start: 5, end: 10, text: 'there', speaker: 'A', emotion: 'hap' },
        ],
      });

      const result = await service.findTranscriptOrThrow('video-1', 'user-1');

      expect(prisma.video.findUnique).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        include: { transcriptSegments: { orderBy: { start: 'asc' } } },
      });
      expect(result).toEqual([
        { start: 0, end: 5, text: 'hi', speaker: undefined, emotion: undefined },
        { start: 5, end: 10, text: 'there', speaker: 'A', emotion: 'hap' },
      ]);
    });

    it('throws NotFoundException when the video does not exist', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.findTranscriptOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        transcriptSegments: [],
      });
      workspaceAccess.assertMinRole.mockRejectedValue(new NotFoundException());

      await expect(service.findTranscriptOrThrow('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // Subtitle Studio roadmap (P2a).
  describe('updateTranscriptSegment', () => {
    it('updates the text and keeps words when the new word count still matches', async () => {
      prisma.transcriptSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        videoId: 'video-1',
        words: [
          { word: 'hello', start: 0, end: 0.5 },
          { word: 'world', start: 0.5, end: 1 },
        ],
      });
      prisma.transcriptSegment.update.mockResolvedValue({ id: 'seg-1', text: 'hiya world' });

      await service.updateTranscriptSegment('video-1', 'seg-1', 'user-1', 'hiya world');

      expect(workspaceAccess.assertVideoAccess).toHaveBeenCalledWith('user-1', 'video-1', 'EDITOR');
      expect(prisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: { text: 'hiya world' },
      });
    });

    it('drops words when the new text has a different word count', async () => {
      prisma.transcriptSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        videoId: 'video-1',
        words: [{ word: 'hello', start: 0, end: 0.5 }],
      });
      prisma.transcriptSegment.update.mockResolvedValue({ id: 'seg-1', text: 'hello there now' });

      await service.updateTranscriptSegment('video-1', 'seg-1', 'user-1', 'hello there now');

      expect(prisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: {
          text: 'hello there now',
          words: Prisma.JsonNull,
          speakingRateWordsPerSecond: null,
        },
      });
    });

    it('throws NotFoundException for a segment that does not belong to this video', async () => {
      prisma.transcriptSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        videoId: 'other-video',
      });

      await expect(
        service.updateTranscriptSegment('video-1', 'seg-1', 'user-1', 'x'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.transcriptSegment.update).not.toHaveBeenCalled();
    });
  });

  // Subtitle Studio roadmap (P2b).
  describe('mergeTranscriptSegments', () => {
    it('combines two adjacent segments, concatenating words and clearing derived audio/translation fields', async () => {
      prisma.transcriptSegment.findMany.mockResolvedValue([
        {
          id: 'seg-1',
          start: 0,
          end: 2,
          text: 'hello',
          words: [{ word: 'hello', start: 0, end: 2 }],
        },
        {
          id: 'seg-2',
          start: 2,
          end: 4,
          text: 'world',
          words: [{ word: 'world', start: 2, end: 4 }],
        },
      ]);
      prisma.transcriptSegment.update.mockResolvedValue({ id: 'seg-1', text: 'hello world' });
      prisma.transcriptSegment.delete.mockResolvedValue({ id: 'seg-2' });

      await service.mergeTranscriptSegments('video-1', 'user-1', 'seg-1', 'seg-2');

      expect(prisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: {
          text: 'hello world',
          end: 4,
          words: [
            { word: 'hello', start: 0, end: 2 },
            { word: 'world', start: 2, end: 4 },
          ],
          speakingRateWordsPerSecond: 0.5,
          rmsDb: null,
          peakDb: null,
          translations: Prisma.JsonNull,
        },
      });
      expect(prisma.transcriptSegment.delete).toHaveBeenCalledWith({ where: { id: 'seg-2' } });
    });

    it('drops words entirely when only one side has word-level data', async () => {
      prisma.transcriptSegment.findMany.mockResolvedValue([
        {
          id: 'seg-1',
          start: 0,
          end: 2,
          text: 'hello',
          words: [{ word: 'hello', start: 0, end: 2 }],
        },
        { id: 'seg-2', start: 2, end: 4, text: 'world', words: null },
      ]);
      prisma.transcriptSegment.update.mockResolvedValue({});
      prisma.transcriptSegment.delete.mockResolvedValue({});

      await service.mergeTranscriptSegments('video-1', 'user-1', 'seg-1', 'seg-2');

      expect(prisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: expect.objectContaining({
          words: Prisma.JsonNull,
          speakingRateWordsPerSecond: null,
        }),
      });
    });

    it('rejects a merge when the two segments are not chronologically adjacent', async () => {
      prisma.transcriptSegment.findMany.mockResolvedValue([
        { id: 'seg-1', start: 0, end: 2, text: 'a', words: null },
        { id: 'seg-2', start: 2, end: 4, text: 'b', words: null },
        { id: 'seg-3', start: 4, end: 6, text: 'c', words: null },
      ]);

      await expect(
        service.mergeTranscriptSegments('video-1', 'user-1', 'seg-1', 'seg-3'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.transcriptSegment.update).not.toHaveBeenCalled();
      expect(prisma.transcriptSegment.delete).not.toHaveBeenCalled();
    });
  });

  // Subtitle Studio roadmap (P2b).
  describe('splitTranscriptSegment', () => {
    it('splits at a word boundary using real word-level timestamps (not approximate)', async () => {
      prisma.transcriptSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        videoId: 'video-1',
        start: 0,
        end: 4,
        speaker: 'Speaker A',
        emotion: 'hap',
        words: [
          { word: 'hello', start: 0, end: 2 },
          { word: 'world', start: 2, end: 4 },
        ],
      });
      prisma.transcriptSegment.update.mockResolvedValue({ id: 'seg-1', text: 'hello' });
      prisma.transcriptSegment.create.mockResolvedValue({ id: 'seg-new', text: 'world' });

      const result = await service.splitTranscriptSegment('video-1', 'seg-1', 'user-1', 1);

      expect(prisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: {
          text: 'hello',
          end: 2,
          words: [{ word: 'hello', start: 0, end: 2 }],
          speakingRateWordsPerSecond: 0.5,
          rmsDb: null,
          peakDb: null,
          translations: Prisma.JsonNull,
        },
      });
      expect(prisma.transcriptSegment.create).toHaveBeenCalledWith({
        data: {
          videoId: 'video-1',
          start: 2,
          end: 4,
          text: 'world',
          speaker: 'Speaker A',
          emotion: 'hap',
          words: [{ word: 'world', start: 2, end: 4 }],
          speakingRateWordsPerSecond: 0.5,
        },
      });
      expect(result.approximate).toBe(false);
    });

    it('falls back to an approximate character-ratio split when the segment has no word-level data, flagging approximate: true', async () => {
      prisma.transcriptSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        videoId: 'video-1',
        start: 0,
        end: 10,
        text: 'hello world',
        speaker: null,
        emotion: null,
        words: null,
      });
      prisma.transcriptSegment.update.mockResolvedValue({ id: 'seg-1', text: 'hello' });
      prisma.transcriptSegment.create.mockResolvedValue({ id: 'seg-new', text: 'world' });

      const result = await service.splitTranscriptSegment('video-1', 'seg-1', 'user-1', 1);

      expect(prisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: expect.objectContaining({ text: 'hello', words: Prisma.JsonNull }),
      });
      expect(prisma.transcriptSegment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ text: 'world', videoId: 'video-1' }),
      });
      expect(result.approximate).toBe(true);
    });

    it('throws BadRequestException for an out-of-range word index', async () => {
      prisma.transcriptSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        videoId: 'video-1',
        start: 0,
        end: 4,
        words: [
          { word: 'hello', start: 0, end: 2 },
          { word: 'world', start: 2, end: 4 },
        ],
      });

      await expect(service.splitTranscriptSegment('video-1', 'seg-1', 'user-1', 5)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.transcriptSegment.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a segment that does not belong to this video', async () => {
      prisma.transcriptSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        videoId: 'other-video',
      });

      await expect(service.splitTranscriptSegment('video-1', 'seg-1', 'user-1', 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // Subtitle Studio roadmap (P2f).
  describe('translateTranscript', () => {
    it('records a request row and enqueues the translate job', async () => {
      const result = await service.translateTranscript('video-1', 'user-1', 'en');

      expect(workspaceAccess.assertVideoAccess).toHaveBeenCalledWith('user-1', 'video-1', 'EDITOR');
      expect(prisma.transcriptTranslationRequest.create).toHaveBeenCalledWith({
        data: { videoId: 'video-1', requestedBy: 'user-1', languageCode: 'en' },
      });
      expect(translateTranscriptQueue.add).toHaveBeenCalledWith('translate-transcript', {
        videoId: 'video-1',
        languageCode: 'en',
      });
      expect(result).toEqual({ status: 'queued', languageCode: 'en' });
    });

    it('throws BadRequestException at the daily rate cap, without enqueueing', async () => {
      prisma.transcriptTranslationRequest.count.mockResolvedValue(5);

      await expect(service.translateTranscript('video-1', 'user-1', 'en')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.transcriptTranslationRequest.create).not.toHaveBeenCalled();
      expect(translateTranscriptQueue.add).not.toHaveBeenCalled();
    });
  });

  // Sprint 03b (Export Center). These reuse findOne/findTranscriptOrThrow
  // for ownership+data (already covered above), so tests here only verify
  // orchestration (right narrowed input assembled, right Prisma calls made)
  // rather than re-verifying report-builder's own section math - that's
  // already covered by its own 29 tests, per ARCHITECTURE.md's "adapter
  // tests mock the module, don't re-test its logic" guidance.
  describe('getVideoReportJson', () => {
    const videoRow = {
      id: 'video-1',
      ownerId: 'user-1',
      title: 'My video',
      durationSeconds: 30,
      transcriptSegments: [{ start: 0, end: 5, text: 'hi', speaker: null, emotion: 'hap' }],
      clips: [
        {
          id: 'clip-1',
          startTime: 0,
          endTime: 5,
          outputUrl: null,
          hookText: 'Hook',
          keywords: [],
          hashtags: [],
          topics: [],
          intent: null,
          ctaText: null,
          scores: null,
          highlightScore: 80,
          highlightConfidence: 0.7,
          highlightReason: 'Strong hook',
          highlightRank: 1,
          publishRecords: [],
        },
      ],
    };

    it('assembles cover/summary/highlight/timeline from findOne + transcript + status events', async () => {
      prisma.video.findUnique.mockResolvedValue(videoRow);
      prisma.videoStatusEvent.findMany.mockResolvedValue([
        {
          toStatus: 'RENDERED',
          errorMessage: null,
          createdAt: new Date('2026-07-17T03:00:00.000Z'),
        },
      ]);

      const result = await service.getVideoReportJson('video-1', 'user-1');

      expect(prisma.videoStatusEvent.findMany).toHaveBeenCalledWith({
        where: { videoId: 'video-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result.cover.videoTitle).toBe('My video');
      expect(result.videoSummary).toEqual({
        durationSeconds: 30,
        clipCount: 1,
        averageHighlightScore: 80,
      });
      expect(result.timeline.events).toEqual([
        { toStatus: 'RENDERED', occurredAt: '2026-07-17T03:00:00.000Z', errorMessage: null },
      ]);
      expect(result.highlight.entries[0]).toMatchObject({ clipId: 'clip-1', highlightScore: 80 });
      expect(result.speechAnalysis.entries[0].vocalEmotion).toEqual({
        dominantEmotion: 'hap',
        counts: { hap: 1 },
      });
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.video.findUnique.mockResolvedValue(videoRow);
      workspaceAccess.assertMinRole.mockRejectedValue(new NotFoundException());

      await expect(service.getVideoReportJson('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getVideoReportCsv', () => {
    it('renders the JSON report as CSV', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        title: 'My video',
        durationSeconds: 30,
        transcriptSegments: [],
        clips: [],
      });

      const csv = await service.getVideoReportCsv('video-1', 'user-1');

      expect(csv).toContain('Cover,,Video Title,My video');
    });
  });

  // Export format expansion (Phase D).
  describe('getVideoReportMarkdown', () => {
    it('renders the JSON report as Markdown', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        title: 'My video',
        durationSeconds: 30,
        transcriptSegments: [],
        clips: [],
      });

      const md = await service.getVideoReportMarkdown('video-1', 'user-1');

      expect(md).toContain('# My video');
    });
  });

  describe('getVideoReportHtml', () => {
    it('renders the JSON report as HTML', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        title: 'My video',
        durationSeconds: 30,
        transcriptSegments: [],
        clips: [],
      });

      const html = await service.getVideoReportHtml('video-1', 'user-1');

      expect(html).toContain('<h1>My video</h1>');
    });
  });

  describe('getClipMetadataJson', () => {
    it('builds clip metadata from findOne', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        clips: [
          {
            id: 'clip-1',
            startTime: 0,
            endTime: 5,
            outputUrl: null,
            hookText: 'Hook',
            keywords: [],
            hashtags: [],
            topics: [],
            intent: null,
            ctaText: null,
            scores: null,
            highlightScore: 80,
            highlightRank: 1,
            publishRecords: [],
          },
        ],
      });

      const result = await service.getClipMetadataJson('video-1', 'user-1');

      expect(result.clips[0]).toMatchObject({ clipId: 'clip-1', highlightScore: 80 });
    });
  });

  describe('getClipMetadataCsv', () => {
    it('renders the clip metadata as CSV with a header row', async () => {
      prisma.video.findUnique.mockResolvedValue({ id: 'video-1', ownerId: 'user-1', clips: [] });

      const csv = await service.getClipMetadataCsv('video-1', 'user-1');

      expect(csv).toContain('ClipId,StartTime,EndTime');
    });
  });

  describe('exportTranscriptTxt / exportCaptionsSrt / exportCaptionsVtt', () => {
    const videoRow = {
      id: 'video-1',
      ownerId: 'user-1',
      transcriptSegments: [{ start: 0, end: 2, text: 'Hello.', speaker: null, emotion: null }],
    };

    it('exportTranscriptTxt renders plain text', async () => {
      prisma.video.findUnique.mockResolvedValue(videoRow);
      expect(await service.exportTranscriptTxt('video-1', 'user-1')).toBe('Hello.\n');
    });

    it('exportCaptionsSrt renders SRT-formatted cues', async () => {
      prisma.video.findUnique.mockResolvedValue(videoRow);
      const srt = await service.exportCaptionsSrt('video-1', 'user-1');
      expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    });

    it('exportCaptionsVtt renders a WEBVTT document', async () => {
      prisma.video.findUnique.mockResolvedValue(videoRow);
      const vtt = await service.exportCaptionsVtt('video-1', 'user-1');
      expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    });
  });

  describe('retry', () => {
    it('throws NotFoundException when the video does not exist', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.retry('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        status: VideoStatus.FAILED,
        clips: [],
        transcriptSegments: [],
      });
      workspaceAccess.assertMinRole.mockRejectedValue(new NotFoundException());

      await expect(service.retry('video-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the video is not FAILED', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        status: VideoStatus.CLIPS_DETECTED,
        clips: [],
        transcriptSegments: [],
      });

      await expect(service.retry('video-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    // Phase C backlog fix - a RENDERED video is only retryable when a later
    // "Generate More Clips" top-up left an unrendered clip behind (see
    // render-clip.worker.ts's catch block, which deliberately leaves the
    // video RENDERED in that case rather than flipping it to FAILED). A
    // RENDERED video with nothing actually broken must still be rejected.
    it('throws BadRequestException when the video is RENDERED but every clip already has output', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        status: VideoStatus.RENDERED,
        clips: [{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }],
        transcriptSegments: [],
      });

      await expect(service.retry('video-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('re-enqueues import-youtube (forwarding the stored provider) when the import never finished downloading', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: '',
        importSourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        status: VideoStatus.FAILED,
        transcriptionProvider: TranscriptionProvider.OPENAI,
        clips: [],
        transcriptSegments: [],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { importProgress: 0, status: VideoStatus.IMPORTING },
      });
      // Fase 3 - retry()'s status changes go through updateVideoStatus(),
      // so every retry transition gets an audit-trail event too, not just
      // creation/the pipeline's own forward progress.
      expect(prisma.videoStatusEvent.create).toHaveBeenCalledWith({
        data: { videoId: 'video-1', toStatus: VideoStatus.IMPORTING, errorMessage: null },
      });
      expect(importYoutubeQueue.add).toHaveBeenCalledWith(
        QueueName.IMPORT_YOUTUBE,
        {
          videoId: 'video-1',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          provider: TranscriptionProvider.OPENAI,
        },
        IMPORT_YOUTUBE_RETRY_OPTIONS,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
    });

    // Quality Validation roadmap (Fase 0 design, Phase 1).
    it('re-enqueues probe-video when probing never completed (no duration/width persisted yet)', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        durationSeconds: null,
        width: null,
        clips: [],
        transcriptSegments: [],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.UPLOADED },
      });
      expect(probeVideoQueue.add).toHaveBeenCalledWith(
        QueueName.PROBE_VIDEO,
        { videoId: 'video-1', sourceUrl: 'videos/abc.mp4' },
        PROBE_VIDEO_RETRY_OPTIONS,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
    });

    it('re-enqueues transcribe (forwarding the stored provider) when no transcript segments exist yet', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        transcriptionProvider: TranscriptionProvider.GROQ,
        // Quality Validation roadmap (Fase 0 design, Phase 1) - probing
        // already succeeded (this video failed transcribe, not probe), so
        // retry()'s new probe-never-completed branch must not fire here.
        durationSeconds: 30,
        width: 1920,
        clips: [],
        transcriptSegments: [],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.UPLOADED, transcribeProgress: 0 },
      });
      expect(transcribeQueue.add).toHaveBeenCalledWith(
        QueueName.TRANSCRIBE,
        { videoId: 'video-1', sourceUrl: 'videos/abc.mp4', provider: TranscriptionProvider.GROQ },
        TRANSCRIBE_RETRY_OPTIONS,
      );
      expect(detectClipsQueue.add).not.toHaveBeenCalled();
      expect(renderClipQueue.add).not.toHaveBeenCalled();
    });

    it('re-enqueues detect-clips when segments exist but no clips do', async () => {
      const segments = [{ start: 0, end: 5, text: 'hi' }];
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        durationSeconds: 30,
        width: 1920,
        clips: [],
        transcriptSegments: segments,
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.TRANSCRIBED },
      });
      expect(detectClipsQueue.add).toHaveBeenCalledWith(
        QueueName.DETECT_CLIPS,
        { videoId: 'video-1', segments },
        DETECT_CLIPS_RETRY_OPTIONS,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
      expect(renderClipQueue.add).not.toHaveBeenCalled();
    });

    it('re-enqueues render-clip only for clips still missing output, with their overlapping transcript', async () => {
      const segments = [
        { start: 0, end: 5, text: 'before' },
        { start: 12, end: 18, text: 'inside' },
      ];
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        durationSeconds: 30,
        width: 1920,
        transcriptSegments: segments,
        clips: [
          {
            id: 'clip-1',
            startTime: 10,
            endTime: 20,
            outputUrl: null,
            captionStyle: 'DEFAULT',
            keywords: ['sunset', 'beach'],
            publishRecords: [],
          },
          {
            id: 'clip-2',
            startTime: 30,
            endTime: 40,
            outputUrl: 'renders/clip-2.mp4',
            captionStyle: 'KARAOKE',
            keywords: [],
            publishRecords: [],
          },
        ],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.CLIPS_DETECTED },
      });
      expect(renderClipQueue.add).toHaveBeenCalledTimes(1);
      expect(renderClipQueue.add).toHaveBeenCalledWith(
        QueueName.RENDER_CLIP,
        {
          clipId: 'clip-1',
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          startTime: 10,
          endTime: 20,
          transcript: [{ start: 12, end: 18, text: 'inside' }],
          captionStyle: 'DEFAULT',
          fontFamily: null,
          watermark: null,
          intro: null,
          outro: null,
          keywords: ['sunset', 'beach'],
          scores: null,
        },
        RENDER_CLIP_RETRY_OPTIONS,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
      expect(detectClipsQueue.add).not.toHaveBeenCalled();
    });

    // Phase C backlog fix - the RENDERED-with-unrendered-top-up-clip case.
    // Same expected behavior as the FAILED case above (temporarily back to
    // CLIPS_DETECTED, re-enqueue only the unrendered clip) - proves the
    // broadened top-level gate falls through the earlier branches unchanged
    // and reaches the exact same final branch, not a special-cased path.
    it('re-enqueues render-clip for a RENDERED video with an unrendered top-up clip (Generate More Clips top-up failure)', async () => {
      const segments = [{ start: 0, end: 5, text: 'inside' }];
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.RENDERED,
        durationSeconds: 30,
        width: 1920,
        transcriptSegments: segments,
        clips: [
          {
            id: 'clip-1',
            startTime: 0,
            endTime: 5,
            outputUrl: 'renders/clip-1.mp4',
            captionStyle: 'DEFAULT',
            keywords: [],
            publishRecords: [],
          },
          {
            id: 'clip-2',
            startTime: 0,
            endTime: 5,
            outputUrl: null,
            captionStyle: 'DEFAULT',
            keywords: ['top-up'],
            publishRecords: [],
          },
        ],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.CLIPS_DETECTED },
      });
      expect(renderClipQueue.add).toHaveBeenCalledTimes(1);
      expect(renderClipQueue.add).toHaveBeenCalledWith(
        QueueName.RENDER_CLIP,
        expect.objectContaining({ clipId: 'clip-2', keywords: ['top-up'] }),
        RENDER_CLIP_RETRY_OPTIONS,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
      expect(detectClipsQueue.add).not.toHaveBeenCalled();
      expect(importYoutubeQueue.add).not.toHaveBeenCalled();
      expect(probeVideoQueue.add).not.toHaveBeenCalled();
    });

    it("resolves the owner's Brand Kit font when a clip has applyBrandKit on and no override", async () => {
      const segments = [{ start: 0, end: 5, text: 'hi' }];
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        workspaceId: 'personal-ws-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        durationSeconds: 30,
        width: 1920,
        transcriptSegments: segments,
        clips: [
          {
            id: 'clip-1',
            startTime: 0,
            endTime: 5,
            outputUrl: null,
            captionStyle: 'DEFAULT',
            keywords: [],
            publishRecords: [],
            applyBrandKit: true,
            fontFamily: null,
          },
        ],
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ brandFontFamily: 'Poppins' });

      await service.retry('video-1', 'user-1');

      expect(renderClipQueue.add).toHaveBeenCalledWith(
        QueueName.RENDER_CLIP,
        expect.objectContaining({ fontFamily: 'Poppins' }),
        RENDER_CLIP_RETRY_OPTIONS,
      );
    });

    // Workspace-level Brand Kit roadmap (P3g).
    describe('workspace-level Brand Kit', () => {
      it("prefers the video's workspace Brand Kit field over the owner's personal one when set", async () => {
        prisma.video.findUnique.mockResolvedValue({
          id: 'video-1',
          ownerId: 'user-1',
          workspaceId: 'team-ws-1',
          sourceUrl: 'videos/abc.mp4',
          status: VideoStatus.FAILED,
          durationSeconds: 30,
          width: 1920,
          transcriptSegments: [{ start: 0, end: 5, text: 'hi' }],
          clips: [
            {
              id: 'clip-1',
              startTime: 0,
              endTime: 5,
              outputUrl: null,
              captionStyle: 'DEFAULT',
              keywords: [],
              publishRecords: [],
              applyBrandKit: true,
              fontFamily: null,
            },
          ],
        });
        prisma.workspace.findUniqueOrThrow.mockResolvedValue({
          isPersonal: false,
          brandFontFamily: 'Oswald',
        });
        prisma.user.findUniqueOrThrow.mockResolvedValue({ brandFontFamily: 'Roboto' });

        await service.retry('video-1', 'user-1');

        expect(prisma.workspace.findUniqueOrThrow).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'team-ws-1' } }),
        );
        expect(renderClipQueue.add).toHaveBeenCalledWith(
          QueueName.RENDER_CLIP,
          expect.objectContaining({ fontFamily: 'Oswald' }),
          RENDER_CLIP_RETRY_OPTIONS,
        );
      });

      it("ignores the workspace's fields entirely for the owner's personal workspace", async () => {
        prisma.video.findUnique.mockResolvedValue({
          id: 'video-1',
          ownerId: 'user-1',
          workspaceId: 'personal-ws-1',
          sourceUrl: 'videos/abc.mp4',
          status: VideoStatus.FAILED,
          durationSeconds: 30,
          width: 1920,
          transcriptSegments: [{ start: 0, end: 5, text: 'hi' }],
          clips: [
            {
              id: 'clip-1',
              startTime: 0,
              endTime: 5,
              outputUrl: null,
              captionStyle: 'DEFAULT',
              keywords: [],
              publishRecords: [],
              applyBrandKit: true,
              fontFamily: null,
            },
          ],
        });
        prisma.workspace.findUniqueOrThrow.mockResolvedValue({
          isPersonal: true,
          brandFontFamily: 'Oswald',
        });
        prisma.user.findUniqueOrThrow.mockResolvedValue({ brandFontFamily: 'Roboto' });

        await service.retry('video-1', 'user-1');

        expect(renderClipQueue.add).toHaveBeenCalledWith(
          QueueName.RENDER_CLIP,
          expect.objectContaining({ fontFamily: 'Roboto' }),
          RENDER_CLIP_RETRY_OPTIONS,
        );
      });
    });

    it('self-heals to RENDERED when every clip already has output', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        durationSeconds: 30,
        width: 1920,
        transcriptSegments: [{ start: 0, end: 5, text: 'hi' }],
        clips: [
          {
            id: 'clip-1',
            startTime: 0,
            endTime: 5,
            outputUrl: 'renders/clip-1.mp4',
            publishRecords: [],
          },
        ],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.RENDERED },
      });
      expect(transcribeQueue.add).not.toHaveBeenCalled();
      expect(detectClipsQueue.add).not.toHaveBeenCalled();
      expect(renderClipQueue.add).not.toHaveBeenCalled();
    });
  });

  // Generate More Clips roadmap (Phase C).
  describe('generateMore', () => {
    const renderedVideo = {
      id: 'video-1',
      ownerId: 'user-1',
      workspaceId: 'workspace-1',
      status: VideoStatus.RENDERED,
      clips: [],
    };

    it('throws NotFoundException when the video does not exist', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(
        service.generateMore('missing', 'user-1', { requestedCount: 2, avoidOverlap: true }),
      ).rejects.toThrow(NotFoundException);
      expect(generateMoreClipsQueue.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.video.findUnique.mockResolvedValue(renderedVideo);
      workspaceAccess.assertMinRole.mockRejectedValue(new NotFoundException());

      await expect(
        service.generateMore('video-1', 'user-1', { requestedCount: 2, avoidOverlap: true }),
      ).rejects.toThrow(NotFoundException);
      expect(generateMoreClipsQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the video is not RENDERED', async () => {
      prisma.video.findUnique.mockResolvedValue({
        ...renderedVideo,
        status: VideoStatus.CLIPS_DETECTED,
      });

      await expect(
        service.generateMore('video-1', 'user-1', { requestedCount: 2, avoidOverlap: true }),
      ).rejects.toThrow(BadRequestException);
      expect(generateMoreClipsQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a clip is still mid-render (outputUrl null)', async () => {
      prisma.video.findUnique.mockResolvedValue(renderedVideo);
      prisma.clip.findFirst.mockResolvedValue({ id: 'clip-in-flight' });

      await expect(
        service.generateMore('video-1', 'user-1', { requestedCount: 2, avoidOverlap: true }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.clip.findFirst).toHaveBeenCalledWith({
        where: { videoId: 'video-1', outputUrl: null },
        select: { id: true },
      });
      expect(generateMoreClipsQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues generate-more-clips with the request params when the video is RENDERED and idle', async () => {
      prisma.video.findUnique.mockResolvedValue(renderedVideo);
      prisma.clip.findFirst.mockResolvedValue(null);

      await service.generateMore('video-1', 'user-1', {
        requestedCount: 3,
        minClipDurationSeconds: 15,
        maxClipDurationSeconds: 90,
        minConfidence: 60,
        avoidOverlap: false,
      });

      expect(generateMoreClipsQueue.add).toHaveBeenCalledWith(
        QueueName.GENERATE_MORE_CLIPS,
        {
          videoId: 'video-1',
          requestedCount: 3,
          minClipDurationSeconds: 15,
          maxClipDurationSeconds: 90,
          minConfidence: 60,
          avoidOverlap: false,
        },
        GENERATE_MORE_CLIPS_RETRY_OPTIONS,
      );
    });
  });

  // Quality Validation roadmap (Fase 0 design, Phase 1).
  describe('startProcessing', () => {
    const processingOptions = {
      version: 1 as const,
      project: { name: 'My Project', tags: ['podcast'] },
      clipGeneration: {
        clipCount: 5 as const,
        minClipDurationSeconds: 30,
        maxClipDurationSeconds: 90,
      },
      subtitle: {
        captionStyle: CaptionStyle.KARAOKE,
        speakerColorCaptions: true,
        fontFamily: null,
      },
      export: { qualityPreset: 'maximum_quality' as const },
      sceneAnalysis: { detectSceneCuts: true, detectMotionEnergy: true, detectCameraMotion: true },
      highlightFocus: { intents: [], confidenceThreshold: null },
      smartCrop: { zoomInFraction: null },
      brandKit: { applyBrandKit: true, templateId: null },
      seo: { autoGeneratePlatformCopy: false, platforms: [] },
      publishing: { autoPublish: false, socialAccountIds: [], scheduledAt: null },
      thumbnail: { preferredSignals: [] },
    };

    it('persists processingOptions, transitions PENDING_SETTINGS to UPLOADED, and enqueues transcribe', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        workspaceId: 'workspace-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.PENDING_SETTINGS,
        transcriptionProvider: TranscriptionProvider.GROQ,
        // findOne()'s mapVideoWithClips() (called at the end of
        // startProcessing() to return the same DTO shape retry() does)
        // needs a real array here.
        clips: [],
      });

      await service.startProcessing('video-1', 'user-1', processingOptions);

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { processingOptions, status: VideoStatus.UPLOADED },
      });
      expect(transcribeQueue.add).toHaveBeenCalledWith(
        QueueName.TRANSCRIBE,
        { videoId: 'video-1', sourceUrl: 'videos/abc.mp4', provider: TranscriptionProvider.GROQ },
        TRANSCRIBE_RETRY_OPTIONS,
      );
    });

    it('throws NotFoundException for a missing video', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.startProcessing('missing', 'user-1', processingOptions)).rejects.toThrow(
        NotFoundException,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the video is not PENDING_SETTINGS', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        workspaceId: 'workspace-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.UPLOADED,
      });

      await expect(service.startProcessing('video-1', 'user-1', processingOptions)).rejects.toThrow(
        BadRequestException,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
    });

    // Phase 4 hardening audit (2026-07-26) - named explicitly by the user as
    // its own invariant ("video FAILED tidak bisa diproses"), not just a
    // side effect of the general !== PENDING_SETTINGS check above.
    it('throws BadRequestException for a FAILED video (cannot be started, only retried)', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        workspaceId: 'workspace-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
      });

      await expect(service.startProcessing('video-1', 'user-1', processingOptions)).rejects.toThrow(
        BadRequestException,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
      expect(probeVideoQueue.add).not.toHaveBeenCalled();
    });

    it('rejects when the requester lacks EDITOR access', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        workspaceId: 'workspace-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.PENDING_SETTINGS,
      });
      workspaceAccess.assertMinRole.mockRejectedValue(new NotFoundException());

      await expect(service.startProcessing('video-1', 'user-1', processingOptions)).rejects.toThrow(
        NotFoundException,
      );
      expect(transcribeQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the video row, cleans up storage, and records an audit log entry', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        workspaceId: 'ws-1',
        title: 'My video',
        sourceUrl: 'videos/abc.mp4',
        clips: [{ outputUrl: 'renders/clip-1.mp4' }, { outputUrl: null }],
      });

      await service.remove('video-1', 'user-1');

      expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'video-1' } });
      // Source + the one rendered clip; the unrendered clip (null outputUrl)
      // contributes no key.
      expect(storage.deleteObjects).toHaveBeenCalledWith(['videos/abc.mp4', 'renders/clip-1.mp4']);
      // Sprint 5F (Audit Log).
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'VIDEO_DELETED',
          actorId: 'user-1',
          targetType: 'Video',
          targetId: 'video-1',
        }),
      });
    });

    it('throws NotFoundException and deletes nothing for a missing video', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.video.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the requester has no workspace access (no delete, no enumeration)', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        clips: [],
      });
      workspaceAccess.assertMinRole.mockRejectedValue(new NotFoundException());

      await expect(service.remove('video-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.video.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });
  });

  describe('move', () => {
    it('moves a video to a new project within the same workspace and records an audit log entry', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        workspaceId: 'ws-1',
        projectId: null,
        folderId: null,
        title: 'My video',
      });
      prisma.project.findUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'ws-1' });
      prisma.video.update.mockResolvedValue({
        id: 'video-1',
        workspaceId: 'ws-1',
        projectId: 'project-1',
        folderId: null,
      });

      const result = await service.move('video-1', 'user-1', { projectId: 'project-1' });

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { workspaceId: 'ws-1', projectId: 'project-1', folderId: null },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'VIDEO_MOVED',
          actorId: 'user-1',
          targetType: 'Video',
          targetId: 'video-1',
          metadata: expect.objectContaining({
            fromWorkspaceId: 'ws-1',
            toWorkspaceId: 'ws-1',
            toProjectId: 'project-1',
            toFolderId: null,
          }),
        }),
      });
      expect(result.projectId).toBe('project-1');
    });

    it('requires EDITOR+ in the destination workspace when moving across workspaces', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        workspaceId: 'ws-1',
        projectId: null,
        folderId: null,
        title: 'My video',
      });
      prisma.video.update.mockResolvedValue({ id: 'video-1', workspaceId: 'ws-2' });

      await service.move('video-1', 'user-1', { workspaceId: 'ws-2' });

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-2', 'EDITOR');
    });

    it('throws BadRequestException when projectId does not belong to the target workspace', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        workspaceId: 'ws-1',
        projectId: null,
        folderId: null,
      });
      prisma.project.findUnique.mockResolvedValue({ id: 'project-1', workspaceId: 'other-ws' });

      await expect(service.move('video-1', 'user-1', { projectId: 'project-1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.video.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing video', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.move('missing', 'user-1', {})).rejects.toThrow(NotFoundException);
    });
  });
});
