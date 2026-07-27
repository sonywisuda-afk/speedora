import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsV2Controller } from './notifications-v2.controller';
import { NotificationsV2Service } from './notifications-v2.service';

// Same shape as notifications.integration.spec.ts (V1) - wires the REAL
// NotificationsV2Controller and REAL NotificationsV2Service together through
// actual NestJS DI, only mocking Prisma at the injection boundary.
describe('Notifications v2 module integration (Controller + Service via real DI)', () => {
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const, emailVerified: true };

  let controller: NotificationsV2Controller;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    notificationThread: { findUnique: jest.Mock };
    notificationCategoryPreference: { findMany: jest.Mock; upsert: jest.Mock };
    notificationWebhook: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      notificationThread: { findUnique: jest.fn() },
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

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsV2Controller],
      providers: [NotificationsV2Service, { provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = moduleRef.get(NotificationsV2Controller);
  });

  it('GET /notifications/v2 defaults to the active, most-recently-updated list, scoped to the requester', async () => {
    await controller.list(user, undefined, undefined, undefined, undefined, undefined, undefined);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', archivedAt: null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('GET /notifications/v2 ignores an invalid state/category/priority query param rather than throwing', async () => {
    await controller.list(
      user,
      undefined,
      undefined,
      'not-a-real-state',
      'NOT_REAL',
      'NOT_REAL',
      undefined,
    );

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', archivedAt: null } }),
    );
  });

  it('GET /notifications/v2/unread-count returns the wrapped count', async () => {
    prisma.notification.count.mockResolvedValue(5);

    const result = await controller.unreadCount(user);

    expect(result).toEqual({ count: 5 });
  });

  it('GET /notifications/v2/threads/:threadId 404s for a thread owned by a different user', async () => {
    prisma.notificationThread.findUnique.mockResolvedValue({
      id: 'thread-1',
      userId: 'someone-else',
      notifications: [],
    });

    await expect(controller.threadDetail(user, 'thread-1')).rejects.toThrow(NotFoundException);
  });

  it('PATCH /notifications/v2/read bulk-marks only the given ids for the requester', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });

    const result = await controller.markRead(user, { ids: ['a', 'b'] });

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { in: ['a', 'b'] }, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(result).toEqual({ count: 2 });
  });

  it('PATCH /notifications/v2/archive bulk-archives only the given ids for the requester', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });

    const result = await controller.archive(user, { ids: ['a'] });

    expect(result).toEqual({ count: 1 });
  });

  it('DELETE /notifications/v2 bulk-deletes only the given ids for the requester', async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 3 });

    const result = await controller.remove(user, { ids: ['a', 'b', 'c'] });

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { in: ['a', 'b', 'c'] } },
    });
    expect(result).toEqual({ count: 3 });
  });

  it('a missing ids array in the bulk-action body is treated as empty, not a crash', async () => {
    const result = await controller.markRead(user, {} as never);

    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ count: 0 });
  });

  it('GET /notifications/v2/preferences returns all 7 groups plus channels, scoped to the requester', async () => {
    const result = await controller.getPreferences(user);

    expect(result.inApp).toHaveLength(7);
    expect(result.channels.length).toBeGreaterThan(0);
    expect(result.essentialNote.length).toBeGreaterThan(0);
  });

  it('PATCH /notifications/v2/preferences/in-app/:group upserts the requester-scoped preference', async () => {
    prisma.notificationCategoryPreference.upsert.mockResolvedValue({});

    const result = await controller.updateInAppPreference(user, 'UPLOAD', { enabled: false });

    expect(prisma.notificationCategoryPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_category_channel: { userId: 'user-1', category: 'UPLOAD', channel: 'IN_APP' },
        },
      }),
    );
    expect(result).toEqual({ group: 'UPLOAD', enabled: false });
  });

  it('PATCH /notifications/v2/preferences/in-app/:group rejects an unknown group', () => {
    expect(() =>
      controller.updateInAppPreference(user, 'NOT_A_REAL_GROUP', { enabled: true }),
    ).toThrow(BadRequestException);
    expect(prisma.notificationCategoryPreference.upsert).not.toHaveBeenCalled();
  });

  it('PATCH /notifications/v2/preferences/channel/:channel updates an already-configured channel', async () => {
    prisma.notificationWebhook.findUnique.mockResolvedValue({ chatId: null });
    prisma.notificationWebhook.update.mockResolvedValue({ enabled: false, chatId: null });

    const result = await controller.updateChannelPreference(user, 'SLACK', { enabled: false });

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

  it('PATCH /notifications/v2/preferences/channel/:channel rejects an unknown channel', () => {
    expect(() =>
      controller.updateChannelPreference(user, 'NOT_A_REAL_CHANNEL', { enabled: true }),
    ).toThrow(BadRequestException);
    expect(prisma.notificationWebhook.findUnique).not.toHaveBeenCalled();
  });

  it('PATCH /notifications/v2/preferences/channel/:channel rejects an unconfigured channel', async () => {
    prisma.notificationWebhook.findUnique.mockResolvedValue(null);

    await expect(
      controller.updateChannelPreference(user, 'DISCORD', { enabled: true }),
    ).rejects.toThrow(BadRequestException);
  });
});
