import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VideoStatus } from '@speedora/database';
import { QueueName, TranscriptionProvider } from '@speedora/shared';
import type { Queue } from 'bullmq';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
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
    videoStatusEvent: { create: jest.Mock };
    activityEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { saveVideo: jest.Mock; deleteObjects: jest.Mock };
  let payments: { getAvailability: jest.Mock; consumeCredit: jest.Mock };
  let importYoutubeQueue: { add: jest.Mock };
  let transcribeQueue: { add: jest.Mock };
  let detectClipsQueue: { add: jest.Mock };
  let renderClipQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      video: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      videoStatusEvent: { create: jest.fn().mockResolvedValue({}) },
      activityEvent: { create: jest.fn().mockResolvedValue({}) },
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
    storage = { saveVideo: jest.fn(), deleteObjects: jest.fn().mockResolvedValue(undefined) };
    payments = {
      getAvailability: jest.fn().mockResolvedValue({ available: true }),
      consumeCredit: jest.fn().mockResolvedValue(true),
    };
    importYoutubeQueue = { add: jest.fn() };
    transcribeQueue = { add: jest.fn() };
    detectClipsQueue = { add: jest.fn() };
    renderClipQueue = { add: jest.fn() };
    service = new VideosService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      payments as unknown as PaymentsService,
      importYoutubeQueue as unknown as Queue,
      transcribeQueue as unknown as Queue,
      detectClipsQueue as unknown as Queue,
      renderClipQueue as unknown as Queue,
    );
  });

  describe('upload', () => {
    it('saves the file to storage, creates the video row (GROQ), and enqueues transcribe', async () => {
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
          sourceUrl: 'videos/abc.mp4',
          transcriptionProvider: TranscriptionProvider.GROQ,
          title: 'my-video.mp4',
          sourceSizeBytes: 2,
        },
      });
      // Fase 3 (DB+JSON-contract roadmap) - the video's first status event,
      // written in the same transaction as its creation.
      expect(prisma.videoStatusEvent.create).toHaveBeenCalledWith({
        data: { videoId: 'video-1', toStatus: VideoStatus.UPLOADED, errorMessage: null },
      });
      // Sprint 1-2 (Dashboard Redesign) - Activity Timeline entry.
      expect(prisma.activityEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'VIDEO_UPLOADED',
          videoId: 'video-1',
          clipId: null,
          metadata: { title: 'my-video.mp4' },
        },
      });
      expect(payments.getAvailability).not.toHaveBeenCalled();
      expect(payments.consumeCredit).not.toHaveBeenCalled();
      expect(transcribeQueue.add).toHaveBeenCalledWith(QueueName.TRANSCRIBE, {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      });
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
      expect(transcribeQueue.add).toHaveBeenCalledWith(QueueName.TRANSCRIBE, {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.OPENAI,
      });
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
      expect(transcribeQueue.add).not.toHaveBeenCalled();
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
          sourceUrl: '',
          importSourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          status: VideoStatus.IMPORTING,
          transcriptionProvider: TranscriptionProvider.GROQ,
        },
      });
      expect(prisma.videoStatusEvent.create).toHaveBeenCalledWith({
        data: { videoId: 'video-1', toStatus: VideoStatus.IMPORTING, errorMessage: null },
      });
      expect(payments.getAvailability).not.toHaveBeenCalled();
      expect(importYoutubeQueue.add).toHaveBeenCalledWith(QueueName.IMPORT_YOUTUBE, {
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.GROQ,
      });
      // Sprint 1-2 (Dashboard Redesign) - Activity Timeline entry. No title
      // metadata yet (unlike upload() above) - the YouTube title isn't known
      // until import-youtube.worker.ts actually runs.
      expect(prisma.activityEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'VIDEO_UPLOADED',
          videoId: 'video-1',
          clipId: null,
          metadata: undefined,
        },
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
      expect(importYoutubeQueue.add).toHaveBeenCalledWith(QueueName.IMPORT_YOUTUBE, {
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.OPENAI,
      });
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
        where: { ownerId: 'user-1' },
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
          storyboardFrameUrls: [],
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
          publishRecords: [],
        },
        {
          id: 'clip-2',
          viralityScore: 40,
          downloadUrl: null,
          thumbnailUrl: null,
          storyboardFrameUrls: [],
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
      expect(result.videos[0].clips[0].thumbnailBlurDataUrl).toBe('data:image/webp;base64,Y2xpcA==');
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

    it('throws NotFoundException when the video belongs to a different user', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'someone-else',
        clips: [],
      });

      await expect(service.findOne('video-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findSourceOrThrow', () => {
    it('returns just the sourceUrl when the video belongs to the requester', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
      });

      const result = await service.findSourceOrThrow('video-1', 'user-1');

      expect(result).toEqual({ sourceUrl: 'videos/abc.mp4' });
    });

    it('throws NotFoundException when the video does not exist', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.findSourceOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the video belongs to a different user', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'someone-else',
        sourceUrl: 'videos/abc.mp4',
      });

      await expect(service.findSourceOrThrow('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findThumbnailOrThrow', () => {
    it('returns just the thumbnailUrl when the video belongs to the requester', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        thumbnailUrl: 'thumbnails/video-1.jpg',
      });

      const result = await service.findThumbnailOrThrow('video-1', 'user-1');

      expect(result).toEqual({ thumbnailUrl: 'thumbnails/video-1.jpg' });
    });

    it('returns a null thumbnailUrl (not a throw) when extraction has not produced one yet', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        thumbnailUrl: null,
      });

      const result = await service.findThumbnailOrThrow('video-1', 'user-1');

      expect(result).toEqual({ thumbnailUrl: null });
    });

    it('throws NotFoundException when the video belongs to a different user', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'someone-else',
        thumbnailUrl: 'thumbnails/video-1.jpg',
      });

      await expect(service.findThumbnailOrThrow('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findStoryboardFrameOrThrow', () => {
    it('returns the raw key at the requested index', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        storyboardFrameUrls: ['storyboards/video-1-0.webp', 'storyboards/video-1-1.webp'],
      });

      const result = await service.findStoryboardFrameOrThrow('video-1', 'user-1', 1);

      expect(result).toEqual({ frameKey: 'storyboards/video-1-1.webp' });
    });

    it('returns a null frameKey (not a throw) when the index is out of range', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        storyboardFrameUrls: ['storyboards/video-1-0.webp'],
      });

      const result = await service.findStoryboardFrameOrThrow('video-1', 'user-1', 5);

      expect(result).toEqual({ frameKey: null });
    });

    it('returns a null frameKey when no storyboard has been extracted yet', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        storyboardFrameUrls: null,
      });

      const result = await service.findStoryboardFrameOrThrow('video-1', 'user-1', 0);

      expect(result).toEqual({ frameKey: null });
    });

    it('throws NotFoundException when the video belongs to a different user', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'someone-else',
        storyboardFrameUrls: ['storyboards/video-1-0.webp'],
      });

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

    it('throws NotFoundException when the video belongs to a different user', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'someone-else',
        transcriptSegments: [],
      });

      await expect(service.findTranscriptOrThrow('video-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('retry', () => {
    it('throws NotFoundException when the video does not exist', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.retry('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the video belongs to a different user', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'someone-else',
        status: VideoStatus.FAILED,
        clips: [],
        transcriptSegments: [],
      });

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
      expect(importYoutubeQueue.add).toHaveBeenCalledWith(QueueName.IMPORT_YOUTUBE, {
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.OPENAI,
      });
      expect(transcribeQueue.add).not.toHaveBeenCalled();
    });

    it('re-enqueues transcribe (forwarding the stored provider) when no transcript segments exist yet', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        transcriptionProvider: TranscriptionProvider.GROQ,
        clips: [],
        transcriptSegments: [],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.UPLOADED, transcribeProgress: 0 },
      });
      expect(transcribeQueue.add).toHaveBeenCalledWith(QueueName.TRANSCRIBE, {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      });
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
        clips: [],
        transcriptSegments: segments,
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.TRANSCRIBED },
      });
      expect(detectClipsQueue.add).toHaveBeenCalledWith(QueueName.DETECT_CLIPS, {
        videoId: 'video-1',
        segments,
      });
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
      expect(renderClipQueue.add).toHaveBeenCalledWith(QueueName.RENDER_CLIP, {
        clipId: 'clip-1',
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        startTime: 10,
        endTime: 20,
        transcript: [{ start: 12, end: 18, text: 'inside' }],
        captionStyle: 'DEFAULT',
        keywords: ['sunset', 'beach'],
        scores: null,
      });
      expect(transcribeQueue.add).not.toHaveBeenCalled();
      expect(detectClipsQueue.add).not.toHaveBeenCalled();
    });

    it('self-heals to RENDERED when every clip already has output', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
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

  describe('remove', () => {
    it('deletes the video row and cleans up the source + rendered clip objects', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        clips: [{ outputUrl: 'renders/clip-1.mp4' }, { outputUrl: null }],
      });

      await service.remove('video-1', 'user-1');

      expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'video-1' } });
      // Source + the one rendered clip; the unrendered clip (null outputUrl)
      // contributes no key.
      expect(storage.deleteObjects).toHaveBeenCalledWith(['videos/abc.mp4', 'renders/clip-1.mp4']);
    });

    it('throws NotFoundException and deletes nothing for a missing video', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.video.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for another user's video (no delete, no enumeration)", async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'someone-else',
        sourceUrl: 'videos/abc.mp4',
        clips: [],
      });

      await expect(service.remove('video-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.video.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });
  });
});
