import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    notificationPreference: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      notificationPreference: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it('queries the most recent notifications for this user, newest first', async () => {
      const createdAt = new Date('2026-07-17T00:00:00.000Z');
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          userId: 'user-1',
          type: 'UPLOAD_COMPLETE',
          title: 'Upload selesai',
          body: 'Video Anda berhasil diunggah.',
          videoId: 'video-1',
          clipId: null,
          metadata: null,
          readAt: null,
          createdAt,
        },
      ]);

      const result = await service.list('user-1', 20);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].id).toBe('notif-1');
      expect(result.notifications[0].readAt).toBeNull();
    });

    it('returns an empty list for a user with no notifications', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      expect(await service.list('user-1', 20)).toEqual({ notifications: [] });
    });
  });

  describe('unreadCount', () => {
    it('counts only unread rows for this user', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.unreadCount('user-1');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('markRead', () => {
    it('sets readAt when the notification belongs to the requester', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markRead('notif-1', 'user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
        data: { readAt: expect.any(Date) },
      });
    });

    it("throws NotFoundException when no row matched (missing or someone else's)", async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markRead('notif-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAllRead', () => {
    it('marks every unread row for this user and returns the count', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(result).toEqual({ count: 5 });
    });
  });

  describe('getPreferences', () => {
    it('returns all 4 types with resolved defaults when no rows exist', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      const result = await service.getPreferences('user-1');

      expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', channel: 'IN_APP' },
      });
      expect(result.preferences).toHaveLength(4);
      expect(result.preferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'UPLOAD_COMPLETE', enabled: true, toast: true }),
          expect.objectContaining({ type: 'RENDER_FAILED', enabled: true, toast: true }),
        ]),
      );
    });

    it('merges an explicit override row (enabled + toast)', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([
        { type: 'RENDER_FAILED', channel: 'IN_APP', enabled: false, config: { toast: false } },
      ]);

      const result = await service.getPreferences('user-1');

      expect(result.preferences).toContainEqual({
        type: 'RENDER_FAILED',
        enabled: false,
        toast: false,
      });
    });
  });

  describe('updatePreference', () => {
    it('upserts on the compound key with the given fields', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      prisma.notificationPreference.upsert.mockResolvedValue({
        type: 'RENDER_FAILED',
        enabled: true,
        config: { toast: false },
      });

      const result = await service.updatePreference('user-1', 'RENDER_FAILED', { toast: false });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_type_channel: { userId: 'user-1', type: 'RENDER_FAILED', channel: 'IN_APP' },
        },
        create: {
          userId: 'user-1',
          type: 'RENDER_FAILED',
          channel: 'IN_APP',
          enabled: true,
          config: { toast: false },
        },
        update: { enabled: true, config: { toast: false } },
      });
      expect(result).toEqual({ type: 'RENDER_FAILED', enabled: true, toast: false });
    });

    it('a partial dto preserves the other field from the existing row', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: false,
        config: { toast: true },
      });
      prisma.notificationPreference.upsert.mockResolvedValue({
        type: 'CLIP_READY',
        enabled: false,
        config: { toast: true },
      });

      await service.updatePreference('user-1', 'CLIP_READY', { toast: true });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { enabled: false, config: { toast: true } } }),
      );
    });

    it('throws BadRequestException for an unknown type', async () => {
      await expect(
        service.updatePreference('user-1', 'NOT_A_REAL_TYPE', { enabled: false }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('toDto', () => {
    it('maps a null readAt to null and a set readAt to an ISO string', () => {
      const createdAt = new Date('2026-07-17T00:00:00.000Z');
      const readAt = new Date('2026-07-17T01:00:00.000Z');

      const unread = service.toDto({
        id: 'notif-1',
        userId: 'user-1',
        type: 'UPLOAD_COMPLETE',
        title: 'Upload selesai',
        body: 'Video Anda berhasil diunggah.',
        videoId: 'video-1',
        clipId: null,
        metadata: null,
        readAt: null,
        createdAt,
      } as never);
      expect(unread.readAt).toBeNull();

      const read = service.toDto({
        id: 'notif-1',
        userId: 'user-1',
        type: 'UPLOAD_COMPLETE',
        title: 'Upload selesai',
        body: 'Video Anda berhasil diunggah.',
        videoId: 'video-1',
        clipId: null,
        metadata: null,
        readAt,
        createdAt,
      } as never);
      expect(read.readAt).toBe(readAt.toISOString());
    });
  });
});
