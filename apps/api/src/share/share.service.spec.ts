import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ShareRole } from '@speedora/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { mapShareRole, ShareService } from './share.service';

describe('ShareService', () => {
  let service: ShareService;
  let prisma: {
    shareLink: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    video: { findUniqueOrThrow: jest.Mock };
    clip: { findUnique: jest.Mock };
    auditLogEntry: { create: jest.Mock };
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
      auditLogEntry: { create: jest.fn().mockResolvedValue({}) },
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
        clipId: null,
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
          clipId: null,
          createdById: 'user-1',
          role: 'VIEWER',
          expiresAt: null,
          tokenHash: expect.any(String),
        }),
      });
      expect(result.url).toMatch(/^https:\/\/app\.speedora\.test\/share\/[a-f0-9]{64}$/);
      // Sprint 5F (Audit Log).
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'SHARE_LINK_CREATED',
          actorId: 'user-1',
          targetType: 'ShareLink',
          targetId: 'link-1',
        }),
      });
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
        clipId: null,
        role: 'VIEWER',
        expiresAt: new Date('2026-07-25T00:00:00.000Z'),
        revokedAt: null,
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

      await service.create('user-1', 'video-1', { expiresInDays: 7 }, 'https://app.test');

      const call = prisma.shareLink.create.mock.calls[0][0];
      expect(call.data.expiresAt).toBeInstanceOf(Date);
    });

    // Collaboration roadmap follow-up (clip-level Share scoping, 2026-08-10).
    it('validates and stores clipId when creating a clip-scoped link', async () => {
      prisma.clip.findUnique.mockResolvedValue({ id: 'clip-1', videoId: 'video-1' });
      prisma.shareLink.create.mockResolvedValue({
        id: 'link-1',
        videoId: 'video-1',
        clipId: 'clip-1',
        role: 'VIEWER',
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

      const result = await service.create(
        'user-1',
        'video-1',
        { clipId: 'clip-1' },
        'https://app.test',
      );

      expect(prisma.shareLink.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ clipId: 'clip-1' }),
      });
      expect(result.clipId).toBe('clip-1');
    });

    it('throws BadRequestException when clipId does not belong to this video', async () => {
      prisma.clip.findUnique.mockResolvedValue({ id: 'clip-1', videoId: 'other-video' });

      await expect(
        service.create('user-1', 'video-1', { clipId: 'clip-1' }, 'https://app.test'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.shareLink.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when clipId does not exist at all', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'video-1', { clipId: 'missing' }, 'https://app.test'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listForVideo', () => {
    it('returns links mapped to DTOs, revoked derived from revokedAt', async () => {
      prisma.shareLink.findMany.mockResolvedValue([
        {
          id: 'link-1',
          videoId: 'video-1',
          clipId: null,
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
      // Sprint 5F (Audit Log).
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'SHARE_LINK_REVOKED',
          actorId: 'user-1',
          targetType: 'ShareLink',
          targetId: 'link-1',
        }),
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
        clipId: null,
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
      expect(result.scopedClipId).toBeNull();
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
        clipId: null,
        revokedAt: null,
        expiresAt: null,
      });
      prisma.clip.findUnique.mockResolvedValue({ id: 'clip-1', videoId: 'other-video' });

      await expect(service.getClipStreamForToken('raw-token', 'clip-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // Collaboration roadmap follow-up (clip-level Share scoping, 2026-08-10) - the real security
  // enforcement: a clip-scoped link must never be able to reach the full source video or any
  // clip other than its own, regardless of what a client requests directly (not just what
  // getPublicView's own DTO happens to expose).
  describe('clip-scoped access control', () => {
    const scopedLink = {
      id: 'link-1',
      videoId: 'video-1',
      clipId: 'clip-1',
      role: 'VIEWER',
      revokedAt: null,
      expiresAt: null,
    };

    it('getPublicView lists only the scoped clip and nulls out sourceStreamUrl/video.thumbnailUrl', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(scopedLink);
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
            hookText: 'Scoped clip',
            hashtags: [],
            outputUrl: 'renders/clip-1.mp4',
            thumbnailUrl: 'thumbnails/clip-1.webp',
          },
          {
            id: 'clip-2',
            startTime: 5,
            endTime: 10,
            hookText: 'Other clip',
            hashtags: [],
            outputUrl: 'renders/clip-2.mp4',
            thumbnailUrl: 'thumbnails/clip-2.webp',
          },
        ],
      });

      const result = await service.getPublicView('raw-token');

      expect(result.scopedClipId).toBe('clip-1');
      expect(result.video.sourceStreamUrl).toBeNull();
      expect(result.video.thumbnailUrl).toBeNull();
      expect(result.clips).toHaveLength(1);
      expect(result.clips[0].id).toBe('clip-1');
    });

    it('getVideoSourceForToken throws Forbidden for a clip-scoped link, even if requested directly', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(scopedLink);

      await expect(service.getVideoSourceForToken('raw-token')).rejects.toThrow(ForbiddenException);
      expect(prisma.video.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('getVideoThumbnailForToken throws Forbidden for a clip-scoped link', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(scopedLink);

      await expect(service.getVideoThumbnailForToken('raw-token')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('getClipStreamForToken succeeds for the scoped clip itself', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(scopedLink);
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        videoId: 'video-1',
        outputUrl: 'renders/clip-1.mp4',
      });

      const result = await service.getClipStreamForToken('raw-token', 'clip-1');

      expect(result.outputUrl).toBe('renders/clip-1.mp4');
    });

    it('getClipStreamForToken throws Forbidden for a different clip in the SAME video, before even looking it up', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(scopedLink);

      await expect(service.getClipStreamForToken('raw-token', 'clip-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.clip.findUnique).not.toHaveBeenCalled();
    });

    it('getClipThumbnailForToken throws Forbidden for a different clip', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(scopedLink);

      await expect(service.getClipThumbnailForToken('raw-token', 'clip-2')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

// Contract Governance audit (2026-08-01) - proves mapShareRole (the
// replacement for the old `as unknown as` cast) round-trips every real
// Prisma ShareRole. If a future schema.prisma addition isn't wired into
// mapShareRole, the build fails before this test can even run (assertNever)
// - this test guards the mapping's runtime correctness, not its
// exhaustiveness, which is a compile-time guarantee.
describe('mapShareRole', () => {
  it('maps every known Prisma ShareRole to its shared counterpart', () => {
    expect(mapShareRole('VIEWER')).toBe(ShareRole.VIEWER);
    expect(mapShareRole('REVIEWER')).toBe(ShareRole.REVIEWER);
  });

  it('throws on an unrecognized value instead of silently passing it through', () => {
    expect(() => mapShareRole('SOMETHING_NEW' as never)).toThrow(/Unhandled ShareRole/);
  });
});
