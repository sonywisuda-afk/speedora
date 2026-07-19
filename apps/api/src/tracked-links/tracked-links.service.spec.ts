import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@speedora/database';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { TrackedLinksService } from './tracked-links.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

describe('TrackedLinksService', () => {
  let service: TrackedLinksService;
  let prisma: {
    trackedLink: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
    publishRecord: { findUnique: jest.Mock };
    campaign: { findUnique: jest.Mock };
  };
  let access: { assertMinRole: jest.Mock };

  const createdLink = {
    id: 'link-1',
    slug: 'aBc12XyZ',
    destinationUrl: 'https://creator.example/landing',
    publishRecordId: 'pr-1',
    campaignId: null,
    clickCount: 0,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = {
      trackedLink: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      publishRecord: { findUnique: jest.fn() },
      campaign: { findUnique: jest.fn() },
    };
    access = { assertMinRole: jest.fn().mockResolvedValue('EDITOR') };

    service = new TrackedLinksService(
      prisma as unknown as PrismaService,
      access as unknown as WorkspaceAccessService,
    );
  });

  describe('create', () => {
    const dto = { destinationUrl: 'https://creator.example/landing', publishRecordId: 'pr-1' };

    it('requires EDITOR+', async () => {
      prisma.publishRecord.findUnique.mockResolvedValue({ clip: { video: { workspaceId: 'ws-1' } } });
      prisma.trackedLink.create.mockResolvedValue(createdLink);

      await service.create('user-1', 'ws-1', dto as never);

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
    });

    it('rejects when neither publishRecordId nor campaignId is provided', async () => {
      await expect(service.create('user-1', 'ws-1', { destinationUrl: 'https://x.example' } as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.trackedLink.create).not.toHaveBeenCalled();
    });

    it('rejects when both publishRecordId and campaignId are provided', async () => {
      await expect(
        service.create('user-1', 'ws-1', {
          destinationUrl: 'https://x.example',
          publishRecordId: 'pr-1',
          campaignId: 'camp-1',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.trackedLink.create).not.toHaveBeenCalled();
    });

    it('rejects a destinationUrl that redirects back into this app own /r/ path', async () => {
      const original = process.env.API_BASE_URL;
      process.env.API_BASE_URL = 'https://api.speedora.example';

      try {
        await expect(
          service.create('user-1', 'ws-1', {
            destinationUrl: 'https://api.speedora.example/r/someslug',
            publishRecordId: 'pr-1',
          } as never),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.trackedLink.create).not.toHaveBeenCalled();
      } finally {
        // Assigning `undefined` to a process.env property coerces it to the
        // string "undefined" (Node env vars are always strings), which
        // would silently poison apiBaseUrl()'s `?? default` fallback for
        // every later test in this file - delete, don't reassign.
        if (original === undefined) delete process.env.API_BASE_URL;
        else process.env.API_BASE_URL = original;
      }
    });

    it('rejects an unparseable destinationUrl', async () => {
      await expect(
        service.create('user-1', 'ws-1', { destinationUrl: 'not-a-url', publishRecordId: 'pr-1' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the publishRecordId does not belong to this workspace', async () => {
      prisma.publishRecord.findUnique.mockResolvedValue({ clip: { video: { workspaceId: 'other-ws' } } });

      await expect(service.create('user-1', 'ws-1', dto as never)).rejects.toThrow(NotFoundException);
      expect(prisma.trackedLink.create).not.toHaveBeenCalled();
    });

    it('rejects when the publishRecordId does not exist at all', async () => {
      prisma.publishRecord.findUnique.mockResolvedValue(null);

      await expect(service.create('user-1', 'ws-1', dto as never)).rejects.toThrow(NotFoundException);
    });

    it('rejects when the campaignId does not belong to this workspace', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ workspaceId: 'other-ws' });

      await expect(
        service.create('user-1', 'ws-1', {
          destinationUrl: 'https://creator.example/landing',
          campaignId: 'camp-1',
        } as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.trackedLink.create).not.toHaveBeenCalled();
    });

    it('creates a link attributed to a publishRecordId in this workspace and shapes the DTO, including redirectUrl', async () => {
      prisma.publishRecord.findUnique.mockResolvedValue({ clip: { video: { workspaceId: 'ws-1' } } });
      prisma.trackedLink.create.mockResolvedValue(createdLink);

      const result = await service.create('user-1', 'ws-1', dto as never);

      expect(prisma.trackedLink.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          slug: expect.any(String),
          destinationUrl: dto.destinationUrl,
          publishRecordId: 'pr-1',
          campaignId: null,
          createdById: 'user-1',
        },
      });
      expect(result).toMatchObject({
        id: 'link-1',
        slug: 'aBc12XyZ',
        destinationUrl: createdLink.destinationUrl,
        publishRecordId: 'pr-1',
        campaignId: null,
        clickCount: 0,
      });
      expect(result.redirectUrl).toContain('/r/aBc12XyZ');
    });

    it('creates a link attributed to a campaignId in this workspace', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });
      prisma.trackedLink.create.mockResolvedValue({ ...createdLink, publishRecordId: null, campaignId: 'camp-1' });

      const result = await service.create('user-1', 'ws-1', {
        destinationUrl: 'https://creator.example/landing',
        campaignId: 'camp-1',
      } as never);

      expect(result.campaignId).toBe('camp-1');
      expect(result.publishRecordId).toBeNull();
    });

    it('retries slug generation on a P2002 collision and succeeds on the next attempt', async () => {
      prisma.publishRecord.findUnique.mockResolvedValue({ clip: { video: { workspaceId: 'ws-1' } } });
      prisma.trackedLink.create.mockRejectedValueOnce(p2002()).mockResolvedValueOnce(createdLink);

      const result = await service.create('user-1', 'ws-1', dto as never);

      expect(prisma.trackedLink.create).toHaveBeenCalledTimes(2);
      expect(result.id).toBe('link-1');
    });

    it('gives up after MAX_SLUG_ATTEMPTS consecutive collisions and surfaces the error', async () => {
      prisma.publishRecord.findUnique.mockResolvedValue({ clip: { video: { workspaceId: 'ws-1' } } });
      prisma.trackedLink.create.mockRejectedValue(p2002());

      await expect(service.create('user-1', 'ws-1', dto as never)).rejects.toThrow();
      expect(prisma.trackedLink.create).toHaveBeenCalledTimes(5);
    });

    it('does not retry on a non-collision error', async () => {
      prisma.publishRecord.findUnique.mockResolvedValue({ clip: { video: { workspaceId: 'ws-1' } } });
      const dbError = new Error('connection lost');
      prisma.trackedLink.create.mockRejectedValue(dbError);

      await expect(service.create('user-1', 'ws-1', dto as never)).rejects.toThrow('connection lost');
      expect(prisma.trackedLink.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('listByWorkspace', () => {
    it('requires VIEWER+ and returns links ordered newest-first', async () => {
      prisma.trackedLink.findMany.mockResolvedValue([createdLink]);

      const result = await service.listByWorkspace('user-1', 'ws-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
      expect(prisma.trackedLink.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1' },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      expect(result.links).toHaveLength(1);
      expect(result.links[0].id).toBe('link-1');
    });
  });

  describe('remove', () => {
    it('requires EDITOR+ on the link own workspace and deletes it', async () => {
      prisma.trackedLink.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });

      await service.remove('user-1', 'link-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.trackedLink.delete).toHaveBeenCalledWith({ where: { id: 'link-1' } });
    });

    it('throws NotFoundException for a missing link, never touching access control', async () => {
      prisma.trackedLink.findUnique.mockResolvedValue(null);

      await expect(service.remove('user-1', 'missing')).rejects.toThrow(NotFoundException);
      expect(access.assertMinRole).not.toHaveBeenCalled();
      expect(prisma.trackedLink.delete).not.toHaveBeenCalled();
    });
  });
});
