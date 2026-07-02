import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ClipsService } from './clips.service';

describe('ClipsService', () => {
  let service: ClipsService;
  let prisma: { clip: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { clip: { findUnique: jest.fn() } };
    service = new ClipsService(prisma as unknown as PrismaService);
  });

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
