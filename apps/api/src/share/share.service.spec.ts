import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { ShareService } from './share.service';

describe('ShareService', () => {
  let service: ShareService;
  let prisma: {
    shareLink: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    video: { findUniqueOrThrow: jest.Mock };
    clip: { findUnique: jest.Mock };
  };
  let workspaceAccess: { assertVideoAccess: jest.Mock; assertMinRole: jest.Mock };

  beforeEach(() => {
    prisma = {
      shareLink: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      video: { findUniqueOrThrow: jest.fn() },
      clip: { findUnique: jest.fn() },
    };
    workspaceAccess = {
      assertVideoAccess: jest.fn().mockResolvedValue({ id: 'video-1', workspaceId: 'ws-1' }),
      assertMinRole: jest.fn().mockResolvedValue('OWNER'),
    };
    service = new ShareService(
      prisma as unknown as PrismaService,
      workspaceAccess as unknown as WorkspaceAccessService,
    );
  });

  describe('create', () => {
    it('creates a ShareLink and returns a URL built from the raw (never persisted) token', async () => {
      const createdAt = new Date('2026-07-18T00:00:00.000Z');
      prisma.shareLink.create.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        role: 'VIEWER',
        expiresAt: null,
        revokedAt: null,
        createdAt,
      });

      const result = await service.create('user-1', 'video-1', {}, 'https://app.speedora.test');

      expect(workspaceAccess.assertVideoAccess).toHaveBeenCalledWith('user-1', 'video-1', 'EDITOR');
      expect(prisma.shareLink.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          videoId: 'video-1',
          createdById: 'user-1',
          role: 'VIEWER',
          expiresAt: null,
          tokenHash: expect.any(String),
        }),
      });
      expect(result.url).toMatch(/^https:\/\/app\.speedora\.test\/share\/[a-f0-9]{64}$/);
      expect(result).toMatchObject({
        id: 'link-1',
        videoId: 'video-1',
        role: 'VIEWER',
        revoked: false,
      });
    });

    it('sets expiresAt when expiresInDays is given', async () => {
      prisma.shareLink.create.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        role: 'VIEWER',
        expiresAt: new Date('2026-07-25T00:00:00.000Z'),
        revokedAt: null,
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

      await service.create('user-1', 'video-1', { expiresInDays: 7 }, 'https://app.test');

      const call = prisma.shareLink.create.mock.calls[0][0];
      expect(call.data.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('listForVideo', () => {
    it('returns links mapped to DTOs, revoked derived from revokedAt', async () => {
      prisma.shareLink.findMany.mockResolvedValue([
        {
          id: 'link-1',
          videoId: 'video-1',
          role: 'VIEWER',
          expiresAt: null,
          revokedAt: new Date('2026-07-18T01:00:00.000Z'),
          createdAt: new Date('2026-07-18T00:00:00.000Z'),
        },
      ]);

      const result = await service.listForVideo('user-1', 'video-1');

      expect(result.links[0].revoked).toBe(true);
    });
  });

  describe('revoke', () => {
    it('sets revokedAt when not already revoked', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        revokedAt: null,
      });
      prisma.video.findUniqueOrThrow.mockResolvedValue({ id: 'video-1', workspaceId: 'ws-1' });

      await service.revoke('user-1', 'link-1');

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.shareLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is a no-op when already revoked', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        revokedAt: new Date(),
      });
      prisma.video.findUniqueOrThrow.mockResolvedValue({ id: 'video-1', workspaceId: 'ws-1' });

      await service.revoke('user-1', 'link-1');

      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the link does not exist', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(null);

      await expect(service.revoke('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('public token resolution', () => {
    it('getPublicView returns the video + clips shaped for a link holder', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        role: 'VIEWER',
        revokedAt: null,
        expiresAt: null,
      });
      prisma.video.findUniqueOrThrow.mockResolvedValue({
        id: 'video-1',
        title: 'My video',
        durationSeconds: 30,
        thumbnailUrl: 'thumbnails/video-1.webp',
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
        clips: [
          {
            id: 'clip-1',
            startTime: 0,
            endTime: 5,
            hookText: 'Hook',
            hashtags: ['viral'],
            outputUrl: 'renders/clip-1.mp4',
            thumbnailUrl: 'thumbnails/clip-1.webp',
          },
        ],
      });

      const result = await service.getPublicView('raw-token');

      expect(result.role).toBe('VIEWER');
      expect(result.video.sourceStreamUrl).toBe('/share/raw-token/source');
      expect(result.clips[0]).toMatchObject({
        id: 'clip-1',
        streamUrl: '/share/raw-token/clips/clip-1/stream',
        thumbnailUrl: '/share/raw-token/clips/clip-1/thumbnail',
      });
    });

    it('throws NotFoundException for an unknown token', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(null);

      await expect(service.getPublicView('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for a revoked link', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        revokedAt: new Date(),
        expiresAt: null,
      });

      await expect(service.getPublicView('raw-token')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for an expired link', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        revokedAt: null,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });

      await expect(service.getPublicView('raw-token')).rejects.toThrow(ForbiddenException);
    });

    it('getClipStreamForToken 404s when the clip does not belong to the linked video', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        revokedAt: null,
        expiresAt: null,
      });
      prisma.clip.findUnique.mockResolvedValue({ id: 'clip-1', videoId: 'other-video' });

      await expect(service.getClipStreamForToken('raw-token', 'clip-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
