import { CaptionStyle } from '@speedora/database';
import type { PrismaService } from '../prisma/prisma.service';
import { SubtitlePresetsService } from './subtitle-presets.service';

describe('SubtitlePresetsService', () => {
  let service: SubtitlePresetsService;
  let prisma: {
    subtitlePreset: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const row = {
    id: 'preset-1',
    userId: 'user-1',
    name: 'My Karaoke',
    captionStyle: CaptionStyle.KARAOKE,
    speakerColorCaptions: true,
    fontFamily: 'Poppins',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    prisma = {
      subtitlePreset: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new SubtitlePresetsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a preset scoped to the requester, defaulting a missing fontFamily to null', async () => {
      prisma.subtitlePreset.create.mockResolvedValue(row);

      const result = await service.create('user-1', {
        name: 'My Karaoke',
        captionStyle: CaptionStyle.KARAOKE,
        speakerColorCaptions: true,
        fontFamily: 'Poppins',
      });

      expect(prisma.subtitlePreset.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          name: 'My Karaoke',
          captionStyle: CaptionStyle.KARAOKE,
          speakerColorCaptions: true,
          fontFamily: 'Poppins',
        },
      });
      expect(result).toEqual({
        id: 'preset-1',
        name: 'My Karaoke',
        captionStyle: CaptionStyle.KARAOKE,
        speakerColorCaptions: true,
        fontFamily: 'Poppins',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('defaults fontFamily to null when omitted', async () => {
      prisma.subtitlePreset.create.mockResolvedValue({ ...row, fontFamily: null });

      await service.create('user-1', {
        name: 'My Karaoke',
        captionStyle: CaptionStyle.KARAOKE,
        speakerColorCaptions: true,
      });

      expect(prisma.subtitlePreset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fontFamily: null }) }),
      );
    });
  });

  describe('list', () => {
    it('scopes to the requester, oldest first, and maps to DTOs', async () => {
      prisma.subtitlePreset.findMany.mockResolvedValue([row]);

      const result = await service.list('user-1');

      expect(prisma.subtitlePreset.findMany).toHaveBeenCalledWith({
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
      prisma.subtitlePreset.findUnique.mockResolvedValue({ ...row, userId: 'someone-else' });

      await expect(service.update('user-1', 'preset-1', { name: 'renamed' })).rejects.toThrow(
        'Subtitle preset preset-1 not found',
      );
      expect(prisma.subtitlePreset.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the preset does not exist', async () => {
      prisma.subtitlePreset.findUnique.mockResolvedValue(null);

      await expect(service.update('user-1', 'missing', { name: 'renamed' })).rejects.toThrow(
        'Subtitle preset missing not found',
      );
    });

    it('only updates the fields actually sent', async () => {
      prisma.subtitlePreset.findUnique.mockResolvedValue(row);
      prisma.subtitlePreset.update.mockResolvedValue({ ...row, name: 'Renamed' });

      await service.update('user-1', 'preset-1', { name: 'Renamed' });

      expect(prisma.subtitlePreset.update).toHaveBeenCalledWith({
        where: { id: 'preset-1' },
        data: { name: 'Renamed' },
      });
    });

    it('clears fontFamily back to null when explicitly sent as null', async () => {
      prisma.subtitlePreset.findUnique.mockResolvedValue(row);
      prisma.subtitlePreset.update.mockResolvedValue({ ...row, fontFamily: null });

      await service.update('user-1', 'preset-1', { fontFamily: null });

      expect(prisma.subtitlePreset.update).toHaveBeenCalledWith({
        where: { id: 'preset-1' },
        data: { fontFamily: null },
      });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException and does not delete when owned by someone else', async () => {
      prisma.subtitlePreset.findUnique.mockResolvedValue({ ...row, userId: 'someone-else' });

      await expect(service.remove('user-1', 'preset-1')).rejects.toThrow(
        'Subtitle preset preset-1 not found',
      );
      expect(prisma.subtitlePreset.delete).not.toHaveBeenCalled();
    });

    it('deletes when owned by the requester', async () => {
      prisma.subtitlePreset.findUnique.mockResolvedValue(row);

      await service.remove('user-1', 'preset-1');

      expect(prisma.subtitlePreset.delete).toHaveBeenCalledWith({ where: { id: 'preset-1' } });
    });
  });
});
