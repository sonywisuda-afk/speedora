import { NotFoundException } from '@nestjs/common';
import { QueueName } from '@viral-clip-app/shared';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  let prisma: { video: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock } };
  let storage: { saveVideo: jest.Mock };
  let transcribeQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = { video: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() } };
    storage = { saveVideo: jest.fn() };
    transcribeQueue = { add: jest.fn() };
    service = new VideosService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      transcribeQueue as unknown as Queue,
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
});
