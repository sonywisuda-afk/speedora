import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VideoStatus } from '@viral-clip-app/database';
import { QueueName } from '@viral-clip-app/shared';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  let prisma: {
    video: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let storage: { saveVideo: jest.Mock };
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
      },
    };
    storage = { saveVideo: jest.fn() };
    transcribeQueue = { add: jest.fn() };
    detectClipsQueue = { add: jest.fn() };
    renderClipQueue = { add: jest.fn() };
    service = new VideosService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      transcribeQueue as unknown as Queue,
      detectClipsQueue as unknown as Queue,
      renderClipQueue as unknown as Queue,
    );
  });

  describe('upload', () => {
    it('saves the file to storage, creates the video row, and enqueues transcribe', async () => {
      storage.saveVideo.mockResolvedValue({ sourceUrl: 'videos/abc.mp4' });
      const createdVideo = { id: 'video-1', ownerId: 'user-1', sourceUrl: 'videos/abc.mp4' };
      prisma.video.create.mockResolvedValue(createdVideo);
      const file = { buffer: Buffer.from('x'), mimetype: 'video/mp4' } as Express.Multer.File;

      const result = await service.upload('user-1', file);

      expect(storage.saveVideo).toHaveBeenCalledWith(file);
      expect(prisma.video.create).toHaveBeenCalledWith({
        data: { ownerId: 'user-1', sourceUrl: 'videos/abc.mp4' },
      });
      expect(transcribeQueue.add).toHaveBeenCalledWith(QueueName.TRANSCRIBE, {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
      });
      expect(result).toEqual(createdVideo);
    });
  });

  describe('findAll', () => {
    it('maps each clip to a downloadUrl and strips the raw outputUrl', async () => {
      prisma.video.findMany.mockResolvedValue([
        {
          id: 'video-1',
          ownerId: 'user-1',
          clips: [
            { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', viralityScore: 90 },
            { id: 'clip-2', outputUrl: null, viralityScore: 40 },
          ],
        },
      ]);

      const result = await service.findAll('user-1');

      expect(prisma.video.findMany).toHaveBeenCalledWith({
        where: { ownerId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        include: { clips: { orderBy: { viralityScore: 'desc' } } },
      });
      expect(result[0].clips).toEqual([
        { id: 'clip-1', viralityScore: 90, downloadUrl: '/clips/clip-1/download' },
        { id: 'clip-2', viralityScore: 40, downloadUrl: null },
      ]);
      expect(result[0].clips[0]).not.toHaveProperty('outputUrl');
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

    it('re-enqueues transcribe when no transcript segments exist yet', async () => {
      prisma.video.findUnique.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        sourceUrl: 'videos/abc.mp4',
        status: VideoStatus.FAILED,
        clips: [],
        transcriptSegments: [],
      });

      await service.retry('video-1', 'user-1');

      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.UPLOADED },
      });
      expect(transcribeQueue.add).toHaveBeenCalledWith(QueueName.TRANSCRIBE, {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
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
          { id: 'clip-1', startTime: 10, endTime: 20, outputUrl: null },
          { id: 'clip-2', startTime: 30, endTime: 40, outputUrl: 'renders/clip-2.mp4' },
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
        clips: [{ id: 'clip-1', startTime: 0, endTime: 5, outputUrl: 'renders/clip-1.mp4' }],
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
});
