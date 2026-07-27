import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsV2Service } from './notifications-v2.service';

describe('NotificationsV2Service', () => {
  let service: NotificationsV2Service;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    notificationThread: { findUnique: jest.Mock };
    video: { findUniqueOrThrow: jest.Mock };
    videoStatusEvent: { findMany: jest.Mock };
    clip: { findMany: jest.Mock };
    notificationCategoryPreference: { findMany: jest.Mock; upsert: jest.Mock };
    notificationWebhook: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      notificationThread: { findUnique: jest.fn() },
      video: { findUniqueOrThrow: jest.fn() },
      videoStatusEvent: { findMany: jest.fn() },
      clip: { findMany: jest.fn() },
      notificationCategoryPreference: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      notificationWebhook: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new NotificationsV2Service(prisma as unknown as PrismaService);
  });

  function notificationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'notif-1',
      userId: 'user-1',
      type: 'CLIP_READY',
      category: 'CLIP_GENERATION',
      priority: 'SUCCESS',
      title: 'Klip siap!',
      body: 'Klip Anda sudah siap ditonton.',
      videoId: 'video-1',
      clipId: 'clip-1',
      metadata: null,
      readAt: null,
      archivedAt: null,
      createdAt: new Date('2026-07-27T00:00:00.000Z'),
      updatedAt: new Date('2026-07-27T00:05:00.000Z'),
      thread: null,
      group: null,
      ...overrides,
    };
  }

  describe('list', () => {
    it('defaults to active (non-archived), most-recently-updated-first, with a real cursor tie-breaker', async () => {
      await service.list('user-1', {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', archivedAt: null },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 21,
        }),
      );
    });

    it('applies state: unread as archivedAt: null AND readAt: null', async () => {
      await service.list('user-1', { state: 'unread' });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', archivedAt: null, readAt: null } }),
      );
    });

    it('applies state: archived as archivedAt: { not: null }', async () => {
      await service.list('user-1', { state: 'archived' });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', archivedAt: { not: null } },
        }),
      );
    });

    it('filters by category and priority when given', async () => {
      await service.list('user-1', { category: 'RENDERING' as never, priority: 'ERROR' as never });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            archivedAt: null,
            category: 'RENDERING',
            priority: 'ERROR',
          },
        }),
      );
    });

    it('searches title OR body (case-insensitive) when q is given', async () => {
      await service.list('user-1', { q: '  My Video  ' });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            archivedAt: null,
            OR: [
              { title: { contains: 'My Video', mode: 'insensitive' } },
              { body: { contains: 'My Video', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('passes a cursor through as { id: cursor }, skip: 1', async () => {
      await service.list('user-1', { cursor: 'notif-99' });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'notif-99' }, skip: 1 }),
      );
    });

    it('reports nextCursor only when more rows exist than the requested limit', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([
        notificationRow({ id: 'a' }),
        notificationRow({ id: 'b' }),
      ]);

      const result = await service.list('user-1', { limit: 1 });

      expect(result.notifications).toHaveLength(1);
      expect(result.nextCursor).toBe('a');
    });

    it('returns null nextCursor when there is no next page', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([notificationRow({ id: 'a' })]);

      const result = await service.list('user-1', { limit: 20 });

      expect(result.nextCursor).toBeNull();
    });

    it('maps a thread-linked row into a NotificationV2Dto with its thread summary, deepLink, and actions', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([
        notificationRow({
          type: 'PIPELINE_PROGRESS',
          category: 'RENDERING',
          priority: 'INFO',
          thread: {
            id: 'thread-1',
            status: 'IN_PROGRESS',
            lastActivityAt: new Date('2026-07-27T00:05:00.000Z'),
          },
        }),
      ]);

      const result = await service.list('user-1', {});

      expect(result.notifications[0]).toMatchObject({
        id: 'notif-1',
        type: 'PIPELINE_PROGRESS',
        thread: { id: 'thread-1', status: 'IN_PROGRESS' },
        group: null,
        deepLink: '/videos/video-1/edit',
      });
      expect(result.notifications[0].actions).toContain('OPEN_VIDEO');
      expect(result.notifications[0].actions).toContain('DISMISS');
    });

    it('derives RETRY/VIEW_LOGS actions for a RENDER_FAILED notification', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([
        notificationRow({ type: 'RENDER_FAILED', category: 'ERRORS', priority: 'ERROR' }),
      ]);

      const result = await service.list('user-1', {});

      expect(result.notifications[0].actions).toEqual(
        expect.arrayContaining(['RETRY', 'VIEW_LOGS', 'DISMISS']),
      );
    });

    it('derives OPEN_CLIP/PUBLISH/VIEW_ANALYTICS actions for a CLIP_READY notification with a clipId', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([notificationRow()]);

      const result = await service.list('user-1', {});

      expect(result.notifications[0].actions).toEqual(
        expect.arrayContaining(['OPEN_CLIP', 'PUBLISH', 'VIEW_ANALYTICS', 'DISMISS']),
      );
    });

    it('returns deepLink: null and actions: [DISMISS] when there is no videoId at all', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([
        notificationRow({ type: 'CREDIT_WARNING', videoId: null, clipId: null }),
      ]);

      const result = await service.list('user-1', {});

      expect(result.notifications[0].deepLink).toBeNull();
      expect(result.notifications[0].actions).toEqual(['DISMISS']);
    });
  });

  describe('unreadCount', () => {
    it('counts unread, non-archived rows for this user (no thread/group exclusion, unlike V1)', async () => {
      prisma.notification.count.mockResolvedValue(4);

      const result = await service.unreadCount('user-1');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null, archivedAt: null },
      });
      expect(result).toEqual({ count: 4 });
    });
  });

  describe('threadDetail', () => {
    it('throws NotFoundException when the thread does not exist', async () => {
      prisma.notificationThread.findUnique.mockResolvedValue(null);

      await expect(service.threadDetail('user-1', 'thread-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the thread belongs to a different user (never leaks existence)', async () => {
      prisma.notificationThread.findUnique.mockResolvedValue({
        id: 'thread-1',
        userId: 'someone-else',
        notifications: [],
      });

      await expect(service.threadDetail('user-1', 'thread-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the thread header, its representative notification, and the live-derived timeline', async () => {
      prisma.notificationThread.findUnique.mockResolvedValue({
        id: 'thread-1',
        userId: 'user-1',
        videoId: 'video-1',
        title: 'Memproses "My Video"',
        status: 'IN_PROGRESS',
        lastActivityAt: new Date('2026-07-27T00:05:00.000Z'),
        archivedAt: null,
        createdAt: new Date('2026-07-27T00:00:00.000Z'),
        notifications: [notificationRow()],
      });
      prisma.video.findUniqueOrThrow.mockResolvedValue({
        id: 'video-1',
        status: 'CLIPS_DETECTED',
        createdAt: new Date('2026-07-27T00:00:00.000Z'),
        importProgress: null,
        transcribeProgress: null,
      });
      prisma.videoStatusEvent.findMany.mockResolvedValue([]);
      prisma.clip.findMany.mockResolvedValue([]);

      const result = await service.threadDetail('user-1', 'thread-1');

      expect(result.thread).toMatchObject({
        id: 'thread-1',
        status: 'IN_PROGRESS',
        videoId: 'video-1',
      });
      expect(result.notification?.id).toBe('notif-1');
      expect(result.timeline).not.toBeNull();
      expect(result.timeline?.videoId).toBe('video-1');
    });
  });

  describe('bulk actions', () => {
    it('markRead updates only the given ids for this user, scoped to still-unread rows', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.markRead('user-1', ['a', 'b']);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', id: { in: ['a', 'b'] }, readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(result).toEqual({ count: 2 });
    });

    it('markRead short-circuits (never touches prisma) for an empty id list', async () => {
      const result = await service.markRead('user-1', []);

      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ count: 0 });
    });

    it('archive updates only the given ids for this user', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.archive('user-1', ['a']);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', id: { in: ['a'] }, archivedAt: null },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it('remove hard-deletes only the given ids for this user', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.remove('user-1', ['a', 'b', 'c']);

      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', id: { in: ['a', 'b', 'c'] } },
      });
      expect(result).toEqual({ count: 3 });
    });

    it('remove is idempotent - deleting an already-deleted/unknown id never errors', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('user-1', ['already-gone'])).resolves.toEqual({ count: 0 });
    });
  });

  describe('Notification Center v2 Phase 5 - simplified preferences', () => {
    describe('getPreferences', () => {
      it('defaults every group to enabled when no category preference rows exist yet', async () => {
        const result = await service.getPreferences('user-1');

        expect(result.inApp).toHaveLength(7);
        expect(result.inApp.every((p) => p.enabled)).toBe(true);
      });

      it('reads a disabled single-category group correctly', async () => {
        prisma.notificationCategoryPreference.findMany.mockResolvedValue([
          { category: 'UPLOAD', enabled: false },
        ]);

        const result = await service.getPreferences('user-1');

        expect(result.inApp.find((p) => p.group === 'UPLOAD')).toEqual({
          group: 'UPLOAD',
          enabled: false,
        });
      });

      it('reads the RENDERING group as enabled only when BOTH underlying categories are enabled', async () => {
        prisma.notificationCategoryPreference.findMany.mockResolvedValue([
          { category: 'RENDERING', enabled: true },
          { category: 'CLIP_GENERATION', enabled: false },
        ]);

        const result = await service.getPreferences('user-1');

        expect(result.inApp.find((p) => p.group === 'RENDERING')).toEqual({
          group: 'RENDERING',
          enabled: false,
        });
      });

      it('never includes WORKSPACE or ERRORS as a toggle (essential, not user-controllable)', async () => {
        const result = await service.getPreferences('user-1');

        expect(result.inApp.map((p) => p.group)).not.toContain('WORKSPACE');
        expect(result.inApp.map((p) => p.group)).not.toContain('ERRORS');
        expect(result.essentialNote.length).toBeGreaterThan(0);
      });

      it('marks a configured, enabled webhook channel correctly', async () => {
        prisma.notificationWebhook.findMany.mockResolvedValue([
          { channel: 'SLACK', enabled: true, chatId: null },
        ]);

        const result = await service.getPreferences('user-1');

        expect(result.channels.find((c) => c.channel === 'SLACK')).toEqual({
          channel: 'SLACK',
          enabled: true,
          configured: true,
          comingSoon: false,
        });
      });

      it('marks an unconfigured webhook channel as disabled and not configured', async () => {
        const result = await service.getPreferences('user-1');

        expect(result.channels.find((c) => c.channel === 'DISCORD')).toEqual({
          channel: 'DISCORD',
          enabled: false,
          configured: false,
          comingSoon: false,
        });
      });

      it('treats TELEGRAM as configured only once chatId is known, same as V1', async () => {
        prisma.notificationWebhook.findMany.mockResolvedValue([
          { channel: 'TELEGRAM', enabled: true, chatId: null },
        ]);

        const result = await service.getPreferences('user-1');

        expect(result.channels.find((c) => c.channel === 'TELEGRAM')?.configured).toBe(false);
      });

      it('marks EMAIL/PUSH/DESKTOP as comingSoon, never enabled/configured', async () => {
        const result = await service.getPreferences('user-1');

        for (const channel of ['EMAIL', 'PUSH', 'DESKTOP']) {
          expect(result.channels.find((c) => c.channel === channel)).toEqual({
            channel,
            enabled: false,
            configured: false,
            comingSoon: true,
          });
        }
      });
    });

    describe('updateInAppPreference', () => {
      it('upserts a single category for a single-category group', async () => {
        prisma.notificationCategoryPreference.upsert.mockResolvedValue({});

        const result = await service.updateInAppPreference('user-1', 'UPLOAD' as never, false);

        expect(prisma.notificationCategoryPreference.upsert).toHaveBeenCalledWith({
          where: {
            userId_category_channel: { userId: 'user-1', category: 'UPLOAD', channel: 'IN_APP' },
          },
          create: { userId: 'user-1', category: 'UPLOAD', channel: 'IN_APP', enabled: false },
          update: { enabled: false },
        });
        expect(result).toEqual({ group: 'UPLOAD', enabled: false });
      });

      it('upserts BOTH underlying categories for the RENDERING group', async () => {
        prisma.notificationCategoryPreference.upsert.mockResolvedValue({});

        await service.updateInAppPreference('user-1', 'RENDERING' as never, true);

        expect(prisma.notificationCategoryPreference.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              userId_category_channel: {
                userId: 'user-1',
                category: 'RENDERING',
                channel: 'IN_APP',
              },
            },
          }),
        );
        expect(prisma.notificationCategoryPreference.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              userId_category_channel: {
                userId: 'user-1',
                category: 'CLIP_GENERATION',
                channel: 'IN_APP',
              },
            },
          }),
        );
        expect(prisma.notificationCategoryPreference.upsert).toHaveBeenCalledTimes(2);
      });
    });

    describe('updateChannelPreference', () => {
      it('rejects IN_APP with a clean 400, directing to the in-app endpoint', async () => {
        await expect(
          service.updateChannelPreference('user-1', 'IN_APP' as never, true),
        ).rejects.toThrow('in-app');
      });

      it('rejects EMAIL/PUSH/DESKTOP as coming soon', async () => {
        await expect(
          service.updateChannelPreference('user-1', 'EMAIL' as never, true),
        ).rejects.toThrow('coming soon');
      });

      it('rejects a channel that has not been configured yet', async () => {
        prisma.notificationWebhook.findUnique.mockResolvedValue(null);

        await expect(
          service.updateChannelPreference('user-1', 'SLACK' as never, true),
        ).rejects.toThrow('not configured');
      });

      it('updates NotificationWebhook.enabled for an already-configured channel', async () => {
        prisma.notificationWebhook.findUnique.mockResolvedValue({ chatId: null });
        prisma.notificationWebhook.update.mockResolvedValue({ enabled: false, chatId: null });

        const result = await service.updateChannelPreference('user-1', 'SLACK' as never, false);

        expect(prisma.notificationWebhook.update).toHaveBeenCalledWith({
          where: { userId_channel: { userId: 'user-1', channel: 'SLACK' } },
          data: { enabled: false },
        });
        expect(result).toEqual({
          channel: 'SLACK',
          enabled: false,
          configured: true,
          comingSoon: false,
        });
      });
    });
  });
});
