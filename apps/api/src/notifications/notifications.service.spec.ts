import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@speedora/shared';
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
    notificationWebhook: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
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
      notificationWebhook: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
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
    it('returns every NotificationType with resolved defaults when no rows exist', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      const result = await service.getPreferences('user-1');

      expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', channel: 'IN_APP' },
      });
      // Not a hardcoded count - Object.values(NotificationType) grows as new
      // types ship (Sprint 4C added STORAGE_WARNING/CREDIT_WARNING), and this
      // service iterates that enum generically rather than a fixed list.
      expect(result.preferences).toHaveLength(Object.values(NotificationType).length);
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

    it('Milestone 04d - queries/upserts a non-IN_APP channel when given, config stays unused', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      prisma.notificationPreference.upsert.mockResolvedValue({
        type: 'CLIP_READY',
        enabled: true,
        config: undefined,
      });

      const result = await service.updatePreference('user-1', 'CLIP_READY', {
        enabled: true,
        channel: 'SLACK' as never,
      });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId_type_channel: { userId: 'user-1', type: 'CLIP_READY', channel: 'SLACK' } },
        create: {
          userId: 'user-1',
          type: 'CLIP_READY',
          channel: 'SLACK',
          enabled: true,
          config: undefined,
        },
        update: { enabled: true, config: undefined },
      });
      // toast is always true for non-IN_APP channels - meaningless outside
      // IN_APP, never persisted.
      expect(result.toast).toBe(true);
    });
  });

  describe('getWebhooks (Milestone 04d/04e)', () => {
    it('returns configured: true only for channels with a saved destination', async () => {
      prisma.notificationWebhook.findMany.mockResolvedValue([{ channel: 'SLACK' }]);

      const result = await service.getWebhooks('user-1');

      expect(prisma.notificationWebhook.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', channel: { in: ['SLACK', 'DISCORD', 'WEBHOOK', 'TELEGRAM'] } },
        select: { channel: true, chatId: true, telegramBotUsername: true },
      });
      expect(result.webhooks).toEqual([
        { channel: 'SLACK', configured: true },
        { channel: 'DISCORD', configured: false },
        { channel: 'WEBHOOK', configured: false },
        { channel: 'TELEGRAM', configured: false, pending: false, telegramBotUsername: undefined },
      ]);
    });

    it('never returns the decrypted (or even encrypted) url', async () => {
      prisma.notificationWebhook.findMany.mockResolvedValue([{ channel: 'SLACK' }]);

      const result = await service.getWebhooks('user-1');

      expect(JSON.stringify(result)).not.toContain('url');
    });

    it('reports a TELEGRAM row with no chatId as pending, not configured', async () => {
      prisma.notificationWebhook.findMany.mockResolvedValue([
        { channel: 'TELEGRAM', chatId: null, telegramBotUsername: 'my_speedora_bot' },
      ]);

      const result = await service.getWebhooks('user-1');

      expect(result.webhooks).toContainEqual({
        channel: 'TELEGRAM',
        configured: false,
        pending: true,
        telegramBotUsername: 'my_speedora_bot',
      });
    });

    it('reports a TELEGRAM row with a chatId as configured, not pending', async () => {
      prisma.notificationWebhook.findMany.mockResolvedValue([
        { channel: 'TELEGRAM', chatId: '999888777', telegramBotUsername: 'my_speedora_bot' },
      ]);

      const result = await service.getWebhooks('user-1');

      expect(result.webhooks).toContainEqual({
        channel: 'TELEGRAM',
        configured: true,
        pending: false,
        telegramBotUsername: 'my_speedora_bot',
      });
    });
  });

  describe('upsertWebhook (Milestone 04d)', () => {
    it('encrypts the url before storing it and returns configured: true', async () => {
      prisma.notificationWebhook.upsert.mockResolvedValue({});

      const result = await service.upsertWebhook(
        'user-1',
        'SLACK' as never,
        'https://hooks.slack.com/services/x',
      );

      expect(prisma.notificationWebhook.upsert).toHaveBeenCalledWith({
        where: { userId_channel: { userId: 'user-1', channel: 'SLACK' } },
        create: {
          userId: 'user-1',
          channel: 'SLACK',
          url: expect.stringMatching(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/),
        },
        update: { url: expect.stringMatching(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/) },
      });
      expect(result).toEqual({ channel: 'SLACK', configured: true });
    });

    it('rejects IN_APP with BadRequestException', async () => {
      await expect(
        service.upsertWebhook('user-1', 'IN_APP' as never, 'https://example.com/hook'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.notificationWebhook.upsert).not.toHaveBeenCalled();
    });

    it('rejects TELEGRAM with BadRequestException (Milestone 04e)', async () => {
      await expect(
        service.upsertWebhook('user-1', 'TELEGRAM' as never, 'https://example.com/hook'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.notificationWebhook.upsert).not.toHaveBeenCalled();
    });
  });

  describe('upsertTelegramWebhook (Milestone 04e)', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn();
      global.fetch = fetchMock as never;
    });

    it('validates the token via getMe, persists with chatId nulled, and returns pending: true', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: { username: 'my_speedora_bot' } }),
      });
      prisma.notificationWebhook.upsert.mockResolvedValue({});

      const result = await service.upsertTelegramWebhook('user-1', '123:abcdefghij');

      expect(prisma.notificationWebhook.upsert).toHaveBeenCalledWith({
        where: { userId_channel: { userId: 'user-1', channel: 'TELEGRAM' } },
        create: {
          userId: 'user-1',
          channel: 'TELEGRAM',
          url: expect.stringMatching(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/),
          telegramBotUsername: 'my_speedora_bot',
        },
        update: {
          url: expect.stringMatching(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/),
          telegramBotUsername: 'my_speedora_bot',
          chatId: null,
          telegramUpdateOffset: null,
        },
      });
      expect(result).toEqual({
        channel: 'TELEGRAM',
        configured: false,
        pending: true,
        telegramBotUsername: 'my_speedora_bot',
      });
    });

    it('throws BadRequestException for an invalid token, persisting nothing', async () => {
      fetchMock.mockResolvedValue({ ok: false, json: async () => null });

      await expect(service.upsertTelegramWebhook('user-1', 'bad-token')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.notificationWebhook.upsert).not.toHaveBeenCalled();
    });
  });

  describe('deleteWebhook (Milestone 04d)', () => {
    it('deletes by (userId, channel), never throwing if nothing existed', async () => {
      prisma.notificationWebhook.deleteMany.mockResolvedValue({ count: 0 });

      await service.deleteWebhook('user-1', 'DISCORD' as never);

      expect(prisma.notificationWebhook.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', channel: 'DISCORD' },
      });
    });

    it('deletes a TELEGRAM row through the same generic path, no special-casing (Milestone 04e)', async () => {
      prisma.notificationWebhook.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteWebhook('user-1', 'TELEGRAM' as never);

      expect(prisma.notificationWebhook.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', channel: 'TELEGRAM' },
      });
    });

    it('rejects IN_APP with BadRequestException', async () => {
      await expect(service.deleteWebhook('user-1', 'IN_APP' as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.notificationWebhook.deleteMany).not.toHaveBeenCalled();
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
