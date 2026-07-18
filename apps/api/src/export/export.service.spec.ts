import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExportType } from '@speedora/shared';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';

describe('ExportService', () => {
  let service: ExportService;
  let prisma: {
    video: { findUnique: jest.Mock };
    exportJob: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  };
  let exportGenerateQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      video: { findUnique: jest.fn() },
      exportJob: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    };
    exportGenerateQueue = { add: jest.fn() };
    service = new ExportService(
      prisma as unknown as PrismaService,
      exportGenerateQueue as unknown as Queue,
    );
  });

  describe('create', () => {
    it('creates a PENDING job and enqueues export-generate with just the job id', async () => {
      prisma.video.findUnique.mockResolvedValue({ id: 'video-1', ownerId: 'user-1' });
      const createdAt = new Date('2026-07-17T00:00:00.000Z');
      prisma.exportJob.create.mockResolvedValue({
        id: 'job-1',
        userId: 'user-1',
        videoId: 'video-1',
        type: 'PDF',
        status: 'PENDING',
        resultUrl: null,
        failReason: null,
        createdAt,
        updatedAt: createdAt,
      });

      const result = await service.create('user-1', { videoId: 'video-1' });

      expect(prisma.exportJob.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', videoId: 'video-1', type: ExportType.PDF },
      });
      expect(exportGenerateQueue.add).toHaveBeenCalledWith('export-generate', {
        exportJobId: 'job-1',
      });
      expect(result).toMatchObject({ id: 'job-1', status: 'PENDING', resultUrl: null });
    });

    it('throws NotFoundException when the video does not exist', async () => {
      prisma.video.findUnique.mockResolvedValue(null);

      await expect(service.create('user-1', { videoId: 'missing' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
      expect(exportGenerateQueue.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the video belongs to a different user', async () => {
      prisma.video.findUnique.mockResolvedValue({ id: 'video-1', ownerId: 'someone-else' });

      await expect(service.create('user-1', { videoId: 'video-1' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when videoId is missing for a video-scoped type', async () => {
      await expect(service.create('user-1', { type: ExportType.PDF })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.video.findUnique).not.toHaveBeenCalled();
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
    });

    it('creates an ANALYTICS_REPORT job with no video lookup and no videoId', async () => {
      const createdAt = new Date('2026-07-18T00:00:00.000Z');
      prisma.exportJob.create.mockResolvedValue({
        id: 'job-1',
        userId: 'user-1',
        videoId: null,
        type: 'ANALYTICS_REPORT',
        status: 'PENDING',
        resultUrl: null,
        failReason: null,
        createdAt,
        updatedAt: createdAt,
      });

      const result = await service.create('user-1', { type: ExportType.ANALYTICS_REPORT });

      expect(prisma.video.findUnique).not.toHaveBeenCalled();
      expect(prisma.exportJob.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', type: ExportType.ANALYTICS_REPORT },
      });
      expect(result.videoId).toBeNull();
    });

    it('throws BadRequestException when videoId is set for ANALYTICS_REPORT', async () => {
      await expect(
        service.create('user-1', { videoId: 'video-1', type: ExportType.ANALYTICS_REPORT }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.video.findUnique).not.toHaveBeenCalled();
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
    });
  });

  describe('findOwnedOrThrow', () => {
    it('returns the job when it belongs to the requester', async () => {
      prisma.exportJob.findUnique.mockResolvedValue({ id: 'job-1', userId: 'user-1' });

      const result = await service.findOwnedOrThrow('job-1', 'user-1');

      expect(result).toEqual({ id: 'job-1', userId: 'user-1' });
    });

    it('throws NotFoundException when the job does not exist', async () => {
      prisma.exportJob.findUnique.mockResolvedValue(null);

      await expect(service.findOwnedOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the job belongs to a different user', async () => {
      prisma.exportJob.findUnique.mockResolvedValue({ id: 'job-1', userId: 'someone-else' });

      await expect(service.findOwnedOrThrow('job-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findReadyOrThrow', () => {
    it('returns the job once it is READY with a resultUrl', async () => {
      const job = {
        id: 'job-1',
        userId: 'user-1',
        status: 'READY',
        resultUrl: 'exports/job-1.pdf',
      };
      prisma.exportJob.findUnique.mockResolvedValue(job);

      expect(await service.findReadyOrThrow('job-1', 'user-1')).toEqual(job);
    });

    it('throws NotFoundException while still PENDING/PROCESSING', async () => {
      prisma.exportJob.findUnique.mockResolvedValue({
        id: 'job-1',
        userId: 'user-1',
        status: 'PROCESSING',
        resultUrl: null,
      });

      await expect(service.findReadyOrThrow('job-1', 'user-1')).rejects.toThrow(
        'Export job job-1 is not ready yet (status: PROCESSING)',
      );
    });

    it('throws NotFoundException for a FAILED job', async () => {
      prisma.exportJob.findUnique.mockResolvedValue({
        id: 'job-1',
        userId: 'user-1',
        status: 'FAILED',
        resultUrl: null,
      });

      await expect(service.findReadyOrThrow('job-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listRecent', () => {
    it('queries the 10 most recent jobs for this user+video, newest first', async () => {
      const createdAt = new Date('2026-07-17T00:00:00.000Z');
      prisma.exportJob.findMany.mockResolvedValue([
        {
          id: 'job-2',
          userId: 'user-1',
          videoId: 'video-1',
          type: 'EXCEL',
          status: 'READY',
          resultUrl: 'exports/job-2.xlsx',
          failReason: null,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: 'job-1',
          userId: 'user-1',
          videoId: 'video-1',
          type: 'PDF',
          status: 'READY',
          resultUrl: 'exports/job-1.pdf',
          failReason: null,
          createdAt,
          updatedAt: createdAt,
        },
      ]);

      const result = await service.listRecent('user-1', { videoId: 'video-1' });

      expect(prisma.exportJob.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', videoId: 'video-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      expect(result.map((job) => job.id)).toEqual(['job-2', 'job-1']);
      // Same toDto() narrowing every other method uses - resultUrl becomes
      // an endpoint path, not the raw storage key.
      expect(result[0].resultUrl).toBe('/export/job-2/download');
    });

    it('returns an empty list for a video with no export jobs', async () => {
      prisma.exportJob.findMany.mockResolvedValue([]);

      expect(await service.listRecent('user-1', { videoId: 'video-1' })).toEqual([]);
    });

    it('filters by type instead of videoId for the account-wide ANALYTICS_REPORT list', async () => {
      prisma.exportJob.findMany.mockResolvedValue([]);

      await service.listRecent('user-1', { type: ExportType.ANALYTICS_REPORT });

      expect(prisma.exportJob.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: ExportType.ANALYTICS_REPORT },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });

  describe('toDto', () => {
    it('exposes resultUrl as a download endpoint path, never the raw storage key', () => {
      const createdAt = new Date('2026-07-17T00:00:00.000Z');
      const dto = service.toDto({
        id: 'job-1',
        userId: 'user-1',
        videoId: 'video-1',
        type: 'PDF',
        status: 'READY',
        resultUrl: 'exports/job-1.pdf',
        failReason: null,
        createdAt,
        updatedAt: createdAt,
      } as never);

      expect(dto.resultUrl).toBe('/export/job-1/download');
    });

    it('reports a null resultUrl while not yet READY, even if the column happens to be set', () => {
      const createdAt = new Date('2026-07-17T00:00:00.000Z');
      const dto = service.toDto({
        id: 'job-1',
        userId: 'user-1',
        videoId: 'video-1',
        type: 'PDF',
        status: 'PROCESSING',
        resultUrl: null,
        failReason: null,
        createdAt,
        updatedAt: createdAt,
      } as never);

      expect(dto.resultUrl).toBeNull();
    });
  });
});
