import { CaptionStyle, DEFAULT_PROCESSING_OPTIONS, type ProcessingOptions } from '@speedora/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { ProcessingPresetsService } from './processing-presets.service';

describe('ProcessingPresetsService', () => {
  let service: ProcessingPresetsService;
  let prisma: {
    processingPreset: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const config: ProcessingOptions = {
    ...DEFAULT_PROCESSING_OPTIONS,
    clipGeneration: { ...DEFAULT_PROCESSING_OPTIONS.clipGeneration, clipCount: 5 },
    subtitle: {
      captionStyle: CaptionStyle.KARAOKE,
      speakerColorCaptions: true,
      fontFamily: 'Poppins',
    },
  };

  const row = {
    id: 'preset-1',
    userId: 'user-1',
    name: 'My Preset',
    config,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    prisma = {
      processingPreset: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new ProcessingPresetsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a preset scoped to the requester', async () => {
      prisma.processingPreset.create.mockResolvedValue(row);

      const result = await service.create('user-1', { name: 'My Preset', config });

      expect(prisma.processingPreset.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', name: 'My Preset', config },
      });
      expect(result).toEqual({
        id: 'preset-1',
        name: 'My Preset',
        config,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('list', () => {
    it('scopes to the requester, oldest first, and maps to DTOs', async () => {
      prisma.processingPreset.findMany.mockResolvedValue([row]);

      const result = await service.list('user-1');

      expect(prisma.processingPreset.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      expect(result.presets).toHaveLength(1);
      expect(result.presets[0].id).toBe('preset-1');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the preset does not belong to the requester', async () => {
      prisma.processingPreset.findUnique.mockResolvedValue({ ...row, userId: 'someone-else' });

      await expect(service.update('user-1', 'preset-1', { name: 'renamed' })).rejects.toThrow(
        'Processing preset preset-1 not found',
      );
      expect(prisma.processingPreset.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the preset does not exist', async () => {
      prisma.processingPreset.findUnique.mockResolvedValue(null);

      await expect(service.update('user-1', 'missing', { name: 'renamed' })).rejects.toThrow(
        'Processing preset missing not found',
      );
    });

    it('only updates the fields actually sent', async () => {
      prisma.processingPreset.findUnique.mockResolvedValue(row);
      prisma.processingPreset.update.mockResolvedValue({ ...row, name: 'Renamed' });

      await service.update('user-1', 'preset-1', { name: 'Renamed' });

      expect(prisma.processingPreset.update).toHaveBeenCalledWith({
        where: { id: 'preset-1' },
        data: { name: 'Renamed' },
      });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException and does not delete when owned by someone else', async () => {
      prisma.processingPreset.findUnique.mockResolvedValue({ ...row, userId: 'someone-else' });

      await expect(service.remove('user-1', 'preset-1')).rejects.toThrow(
        'Processing preset preset-1 not found',
      );
      expect(prisma.processingPreset.delete).not.toHaveBeenCalled();
    });

    it('deletes when owned by the requester', async () => {
      prisma.processingPreset.findUnique.mockResolvedValue(row);

      await service.remove('user-1', 'preset-1');

      expect(prisma.processingPreset.delete).toHaveBeenCalledWith({ where: { id: 'preset-1' } });
    });
  });
});
