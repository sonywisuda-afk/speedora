import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueueName } from '@viral-clip-app/shared';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import { ClipsService } from './clips.service';

describe('ClipsService', () => {
  let service: ClipsService;
  let prisma: {
    clip: { findUnique: jest.Mock; update: jest.Mock };
    transcriptSegment: { findMany: jest.Mock };
  };
  let renderClipQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      clip: { findUnique: jest.fn(), update: jest.fn() },
      transcriptSegment: { findMany: jest.fn() },
    };
    renderClipQueue = { add: jest.fn() };
    service = new ClipsService(
      prisma as unknown as PrismaService,
      renderClipQueue as unknown as Queue,
    );
  });

  describe('findRenderedOrThrow', () => {
    it('returns the clip when it belongs to the requester and has finished rendering', async () => {
      const clip = {
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'user-1' },
      };
      prisma.clip.findUnique.mockResolvedValue(clip);

      const result = await service.findRenderedOrThrow('clip-1', 'user-1');

      expect(result).toBe(clip);
    });

    it('throws NotFoundException when the clip does not exist', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.findRenderedOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'someone-else' },
      });

      await expect(service.findRenderedOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip has not finished rendering yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findRenderedOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const existingClip = {
      id: 'clip-1',
      videoId: 'video-1',
      startTime: 10,
      endTime: 20,
      viralityScore: 80,
      outputUrl: 'renders/clip-1.mp4',
      updatedAt: new Date('2026-01-01'),
      video: { ownerId: 'user-1' },
    };

    it('updates startTime and endTime and returns a downloadUrl-mapped dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, startTime: 12, endTime: 22 });

      const result = await service.update('clip-1', 'user-1', { startTime: 12, endTime: 22 });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: { startTime: 12, endTime: 22 },
      });
      expect(result).toEqual({
        id: 'clip-1',
        videoId: 'video-1',
        startTime: 12,
        endTime: 22,
        viralityScore: 80,
        downloadUrl: '/clips/clip-1/download',
        updatedAt: existingClip.updatedAt,
      });
    });

    it('allows updating just one field, validating against the other current value', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, endTime: 25 });

      await service.update('clip-1', 'user-1', { endTime: 25 });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: { startTime: 10, endTime: 25 },
      });
    });

    it('throws BadRequestException when startTime would not be before endTime', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);

      await expect(service.update('clip-1', 'user-1', { startTime: 25 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.clip.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...existingClip,
        video: { ownerId: 'someone-else' },
      });

      await expect(service.update('clip-1', 'user-1', { startTime: 12 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('render', () => {
    const clip = {
      id: 'clip-1',
      videoId: 'video-1',
      startTime: 10,
      endTime: 20,
      viralityScore: 80,
      outputUrl: 'renders/clip-1.mp4',
      updatedAt: new Date('2026-01-01'),
      video: { ownerId: 'user-1', sourceUrl: 'videos/abc.mp4' },
    };

    it('clears outputUrl, enqueues render-clip with the recomputed transcript, and returns the cleared dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);
      const segments = [
        { start: 0, end: 5, text: 'before' },
        { start: 12, end: 18, text: 'inside' },
      ];
      prisma.transcriptSegment.findMany.mockResolvedValue(segments);
      const cleared = { ...clip, outputUrl: null, updatedAt: new Date('2026-01-02') };
      prisma.clip.update.mockResolvedValue(cleared);

      const result = await service.render('clip-1', 'user-1');

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: { outputUrl: null },
      });
      expect(renderClipQueue.add).toHaveBeenCalledWith(QueueName.RENDER_CLIP, {
        clipId: 'clip-1',
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        startTime: 10,
        endTime: 20,
        transcript: [{ start: 12, end: 18, text: 'inside' }],
      });
      expect(result).toEqual({
        id: 'clip-1',
        videoId: 'video-1',
        startTime: 10,
        endTime: 20,
        viralityScore: 80,
        downloadUrl: null,
        updatedAt: cleared.updatedAt,
      });
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...clip,
        video: { ...clip.video, ownerId: 'someone-else' },
      });

      await expect(service.render('clip-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(renderClipQueue.add).not.toHaveBeenCalled();
    });
  });
});
