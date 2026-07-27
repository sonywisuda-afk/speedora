import { Prisma } from './generated/prisma/client';
import {
  recordGroupedNotification,
  recordNotification,
  recordReadReceipt,
  recordThreadNotification,
} from './notification';

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

describe('recordNotification', () => {
  it('creates one Notification row with the given type/title/body', async () => {
    const create = jest.fn().mockResolvedValue({});
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { notification: { create }, notificationPreference: { findUnique } };

    await recordNotification(prisma as never, {
      userId: 'user-1',
      type: 'UPLOAD_COMPLETE' as never,
      title: 'Upload selesai',
      body: 'Video Anda berhasil diunggah.',
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_type_channel: { userId: 'user-1', type: 'UPLOAD_COMPLETE', channel: 'IN_APP' },
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'UPLOAD_COMPLETE',
        category: 'UPLOAD',
        priority: 'INFO',
        title: 'Upload selesai',
        body: 'Video Anda berhasil diunggah.',
        videoId: null,
        clipId: null,
        metadata: undefined,
      },
    });
  });

  it('includes videoId/clipId/metadata when given', async () => {
    const create = jest.fn().mockResolvedValue({});
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { notification: { create }, notificationPreference: { findUnique } };

    await recordNotification(prisma as never, {
      userId: 'user-1',
      type: 'RENDER_FAILED' as never,
      title: 'Proses video gagal',
      body: 'Video "My Video" gagal diproses. Silakan coba lagi.',
      videoId: 'video-1',
      clipId: 'clip-1',
      metadata: { errorMessage: 'boom' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'RENDER_FAILED',
        category: 'ERRORS',
        priority: 'ERROR',
        title: 'Proses video gagal',
        body: 'Video "My Video" gagal diproses. Silakan coba lagi.',
        videoId: 'video-1',
        clipId: 'clip-1',
        metadata: { errorMessage: 'boom' },
      },
    });
  });

  it('skips creating a row when the user has disabled this notification type (IN_APP)', async () => {
    const create = jest.fn().mockResolvedValue({});
    const findUnique = jest.fn().mockResolvedValue({ enabled: false });
    const prisma = { notification: { create }, notificationPreference: { findUnique } };

    await recordNotification(prisma as never, {
      userId: 'user-1',
      type: 'RENDER_FAILED' as never,
      title: 'Proses video gagal',
      body: 'Video gagal diproses.',
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('still creates a row when a preference exists but is enabled (regression guard for the default)', async () => {
    const create = jest.fn().mockResolvedValue({});
    const findUnique = jest.fn().mockResolvedValue({ enabled: true });
    const prisma = { notification: { create }, notificationPreference: { findUnique } };

    await recordNotification(prisma as never, {
      userId: 'user-1',
      type: 'CLIP_READY' as never,
      title: 'Klip siap!',
      body: 'Klip Anda sudah siap ditonton.',
    });

    expect(create).toHaveBeenCalled();
  });

  describe('Notification Center v2 Phase 5 - category-level suppression', () => {
    it('skips creating a row when the category is disabled, even though the type preference is enabled', async () => {
      const create = jest.fn().mockResolvedValue({});
      const notificationPreferenceFindUnique = jest.fn().mockResolvedValue(null);
      const notificationCategoryPreferenceFindUnique = jest
        .fn()
        .mockResolvedValue({ enabled: false });
      const prisma = {
        notification: { create },
        notificationPreference: { findUnique: notificationPreferenceFindUnique },
        notificationCategoryPreference: { findUnique: notificationCategoryPreferenceFindUnique },
      };

      await recordNotification(prisma as never, {
        userId: 'user-1',
        type: 'RENDER_FAILED' as never,
        title: 'Proses video gagal',
        body: 'Video gagal diproses.',
      });

      expect(notificationCategoryPreferenceFindUnique).toHaveBeenCalledWith({
        where: {
          userId_category_channel: { userId: 'user-1', category: 'ERRORS', channel: 'IN_APP' },
        },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('still creates a row when the category preference row is absent (default-enabled)', async () => {
      const create = jest.fn().mockResolvedValue({});
      const prisma = {
        notification: { create },
        notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
        notificationCategoryPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      };

      await recordNotification(prisma as never, {
        userId: 'user-1',
        type: 'CLIP_READY' as never,
        title: 'Klip siap!',
        body: 'Klip Anda sudah siap ditonton.',
      });

      expect(create).toHaveBeenCalled();
    });

    it('never suppresses (fails open) when the caller has no notificationCategoryPreference table wired at all', async () => {
      const create = jest.fn().mockResolvedValue({});
      const prisma = {
        notification: { create },
        notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
        // notificationCategoryPreference deliberately absent - simulates
        // every pre-Phase-5 call site/test.
      };

      await recordNotification(prisma as never, {
        userId: 'user-1',
        type: 'CLIP_READY' as never,
        title: 'Klip siap!',
        body: 'Klip Anda sudah siap ditonton.',
      });

      expect(create).toHaveBeenCalled();
    });
  });

  describe('deps.publish (Milestone 04c)', () => {
    it('calls deps.publish with the created row id after a successful write', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = { notification: { create }, notificationPreference: { findUnique } };
      const publish = jest.fn().mockResolvedValue(undefined);

      await recordNotification(
        prisma as never,
        {
          userId: 'user-1',
          type: 'CLIP_READY' as never,
          title: 'Klip siap!',
          body: 'Klip Anda sudah siap ditonton.',
        },
        { publish },
      );

      expect(publish).toHaveBeenCalledWith({
        userId: 'user-1',
        notificationId: 'notif-1',
        type: 'CLIP_READY',
      });
    });

    it('does not call deps.publish when the preference gate skips the write', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue({ enabled: false });
      const prisma = { notification: { create }, notificationPreference: { findUnique } };
      const publish = jest.fn();

      await recordNotification(
        prisma as never,
        {
          userId: 'user-1',
          type: 'CLIP_READY' as never,
          title: 'Klip siap!',
          body: 'Klip Anda sudah siap ditonton.',
        },
        { publish },
      );

      expect(publish).not.toHaveBeenCalled();
    });

    it('does not reject when deps.publish itself rejects', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = { notification: { create }, notificationPreference: { findUnique } };
      const publish = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(
        recordNotification(
          prisma as never,
          {
            userId: 'user-1',
            type: 'CLIP_READY' as never,
            title: 'Klip siap!',
            body: 'Klip Anda sudah siap ditonton.',
          },
          { publish },
        ),
      ).resolves.toBeUndefined();
    });

    it('does not call deps.publish when no publish dep is given', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = { notification: { create }, notificationPreference: { findUnique } };

      await expect(
        recordNotification(prisma as never, {
          userId: 'user-1',
          type: 'CLIP_READY' as never,
          title: 'Klip siap!',
          body: 'Klip Anda sudah siap ditonton.',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('deps.enqueueDelivery (Milestone 04d)', () => {
    it('calls deps.enqueueDelivery with the created row id after a successful write', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = { notification: { create }, notificationPreference: { findUnique } };
      const enqueueDelivery = jest.fn().mockResolvedValue(undefined);

      await recordNotification(
        prisma as never,
        {
          userId: 'user-1',
          type: 'CLIP_READY' as never,
          title: 'Klip siap!',
          body: 'Klip Anda sudah siap ditonton.',
        },
        { enqueueDelivery },
      );

      expect(enqueueDelivery).toHaveBeenCalledWith({ notificationId: 'notif-1' });
    });

    it('does not call deps.enqueueDelivery when the preference gate skips the write', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue({ enabled: false });
      const prisma = { notification: { create }, notificationPreference: { findUnique } };
      const enqueueDelivery = jest.fn();

      await recordNotification(
        prisma as never,
        {
          userId: 'user-1',
          type: 'CLIP_READY' as never,
          title: 'Klip siap!',
          body: 'Klip Anda sudah siap ditonton.',
        },
        { enqueueDelivery },
      );

      expect(enqueueDelivery).not.toHaveBeenCalled();
    });

    it('does not reject when deps.enqueueDelivery itself rejects', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = { notification: { create }, notificationPreference: { findUnique } };
      const enqueueDelivery = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(
        recordNotification(
          prisma as never,
          {
            userId: 'user-1',
            type: 'CLIP_READY' as never,
            title: 'Klip siap!',
            body: 'Klip Anda sudah siap ditonton.',
          },
          { enqueueDelivery },
        ),
      ).resolves.toBeUndefined();
    });

    it('a failing deps.publish does not skip deps.enqueueDelivery (separate try/catch)', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = { notification: { create }, notificationPreference: { findUnique } };
      const publish = jest.fn().mockRejectedValue(new Error('redis down'));
      const enqueueDelivery = jest.fn().mockResolvedValue(undefined);

      await recordNotification(
        prisma as never,
        {
          userId: 'user-1',
          type: 'CLIP_READY' as never,
          title: 'Klip siap!',
          body: 'Klip Anda sudah siap ditonton.',
        },
        { publish, enqueueDelivery },
      );

      expect(enqueueDelivery).toHaveBeenCalledWith({ notificationId: 'notif-1' });
    });
  });
});

describe('recordThreadNotification', () => {
  function makePrisma() {
    return {
      notification: { create: jest.fn(), update: jest.fn() },
      notificationThread: { create: jest.fn(), update: jest.fn() },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  }

  it('creates a new thread and its representative notification on first call', async () => {
    const prisma = makePrisma();
    prisma.notificationThread.create.mockResolvedValue({ id: 'thread-1' });
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });

    const result = await recordThreadNotification(prisma as never, {
      userId: 'user-1',
      type: 'UPLOAD_COMPLETE' as never,
      title: 'Processing "My Video"',
      body: 'Upload started',
      threadKey: 'PIPELINE:video-1',
      status: 'IN_PROGRESS' as never,
      videoId: 'video-1',
    });

    expect(prisma.notificationThread.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        key: 'PIPELINE:video-1',
        videoId: 'video-1',
        title: 'Processing "My Video"',
        status: 'IN_PROGRESS',
      }),
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'UPLOAD_COMPLETE',
        category: 'UPLOAD',
        priority: 'INFO',
        title: 'Processing "My Video"',
        body: 'Upload started',
        threadId: 'thread-1',
      }),
    });
    expect(result).toEqual({
      notification: { id: 'notif-1' },
      thread: { id: 'thread-1' },
      created: true,
    });
  });

  it('updates the existing thread and representative notification on a repeat call (P2002)', async () => {
    const prisma = makePrisma();
    prisma.notificationThread.create.mockRejectedValue(p2002());
    prisma.notificationThread.update.mockResolvedValue({ id: 'thread-1' });
    prisma.notification.create.mockRejectedValue(p2002());
    prisma.notification.update.mockResolvedValue({ id: 'notif-1' });

    const result = await recordThreadNotification(prisma as never, {
      userId: 'user-1',
      type: 'CLIP_READY' as never,
      title: 'Processing "My Video"',
      body: 'Rendering clips',
      threadKey: 'PIPELINE:video-1',
      status: 'IN_PROGRESS' as never,
      videoId: 'video-1',
    });

    expect(prisma.notificationThread.update).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user-1', key: 'PIPELINE:video-1' } },
      data: expect.objectContaining({
        title: 'Processing "My Video"',
        status: 'IN_PROGRESS',
        archivedAt: null,
      }),
    });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { threadId: 'thread-1' },
      data: expect.objectContaining({
        title: 'Processing "My Video"',
        body: 'Rendering clips',
        readAt: null,
        archivedAt: null,
      }),
    });
    expect(result.created).toBe(false);
  });

  it('does not resurface (clear readAt/archivedAt) when resurface: false', async () => {
    const prisma = makePrisma();
    prisma.notificationThread.create.mockRejectedValue(p2002());
    prisma.notificationThread.update.mockResolvedValue({ id: 'thread-1' });
    prisma.notification.create.mockRejectedValue(p2002());
    prisma.notification.update.mockResolvedValue({ id: 'notif-1' });

    await recordThreadNotification(prisma as never, {
      userId: 'user-1',
      type: 'CLIP_READY' as never,
      title: 'Processing "My Video"',
      body: 'Rendering clips',
      threadKey: 'PIPELINE:video-1',
      status: 'IN_PROGRESS' as never,
      resurface: false,
    });

    const threadUpdateData = prisma.notificationThread.update.mock.calls[0][0].data;
    const notificationUpdateData = prisma.notification.update.mock.calls[0][0].data;
    expect(threadUpdateData.archivedAt).toBeUndefined();
    expect(notificationUpdateData.readAt).toBeUndefined();
    expect(notificationUpdateData.archivedAt).toBeUndefined();
  });

  it('skips both writes when the user has disabled this notification type (IN_APP)', async () => {
    const prisma = makePrisma();
    prisma.notificationPreference.findUnique.mockResolvedValue({ enabled: false });

    const result = await recordThreadNotification(prisma as never, {
      userId: 'user-1',
      type: 'CLIP_READY' as never,
      title: 'Processing "My Video"',
      body: 'Rendering clips',
      threadKey: 'PIPELINE:video-1',
      status: 'IN_PROGRESS' as never,
    });

    expect(prisma.notificationThread.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });

  it('skips both writes when the resolved category is disabled (Phase 5 simplified preferences)', async () => {
    const prisma = {
      ...makePrisma(),
      notificationCategoryPreference: {
        findUnique: jest.fn().mockResolvedValue({ enabled: false }),
      },
    };

    const result = await recordThreadNotification(prisma as never, {
      userId: 'user-1',
      type: 'PIPELINE_PROGRESS' as never,
      title: 'Memproses "My Video"',
      body: 'Rendering: 1 dari 2 klip selesai.',
      threadKey: 'PIPELINE:video-1',
      status: 'IN_PROGRESS' as never,
      category: 'RENDERING' as never,
    });

    expect(prisma.notificationCategoryPreference.findUnique).toHaveBeenCalledWith({
      where: {
        userId_category_channel: { userId: 'user-1', category: 'RENDERING', channel: 'IN_APP' },
      },
    });
    expect(prisma.notificationThread.create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });

  it('only enqueues delivery on the first occurrence, not on a plain progress bump', async () => {
    const prisma = makePrisma();
    prisma.notificationThread.create.mockRejectedValue(p2002());
    prisma.notificationThread.update.mockResolvedValue({ id: 'thread-1' });
    prisma.notification.create.mockRejectedValue(p2002());
    prisma.notification.update.mockResolvedValue({ id: 'notif-1' });
    const enqueueDelivery = jest.fn().mockResolvedValue(undefined);

    await recordThreadNotification(
      prisma as never,
      {
        userId: 'user-1',
        type: 'CLIP_READY' as never,
        title: 'Processing "My Video"',
        body: 'Rendering clips',
        threadKey: 'PIPELINE:video-1',
        status: 'IN_PROGRESS' as never,
      },
      { enqueueDelivery },
    );

    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it('enqueues delivery on a progress bump when terminal: true', async () => {
    const prisma = makePrisma();
    prisma.notificationThread.create.mockRejectedValue(p2002());
    prisma.notificationThread.update.mockResolvedValue({ id: 'thread-1' });
    prisma.notification.create.mockRejectedValue(p2002());
    prisma.notification.update.mockResolvedValue({ id: 'notif-1' });
    const enqueueDelivery = jest.fn().mockResolvedValue(undefined);

    await recordThreadNotification(
      prisma as never,
      {
        userId: 'user-1',
        type: 'CLIP_READY' as never,
        title: 'Processing "My Video"',
        body: 'Done',
        threadKey: 'PIPELINE:video-1',
        status: 'COMPLETED' as never,
        terminal: true,
      },
      { enqueueDelivery },
    );

    expect(enqueueDelivery).toHaveBeenCalledWith({ notificationId: 'notif-1' });
  });
});

describe('recordGroupedNotification', () => {
  function makePrisma() {
    return {
      notification: { create: jest.fn(), update: jest.fn() },
      notificationGroup: { create: jest.fn(), update: jest.fn() },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  }

  it('creates a new group and its representative notification on first call', async () => {
    const prisma = makePrisma();
    prisma.notificationGroup.create.mockResolvedValue({ id: 'group-1' });
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });

    const result = await recordGroupedNotification(prisma as never, {
      userId: 'user-1',
      type: 'STORAGE_WARNING' as never,
      title: 'Storage almost full',
      body: 'You are near your storage limit.',
      groupKey: 'TYPE:STORAGE_WARNING',
    });

    expect(prisma.notificationGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        key: 'TYPE:STORAGE_WARNING',
        occurrenceCount: 1,
      }),
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        groupId: 'group-1',
        category: 'SYSTEM',
        priority: 'WARNING',
      }),
    });
    expect(result).toEqual({
      notification: { id: 'notif-1' },
      group: { id: 'group-1' },
      created: true,
    });
  });

  it('increments occurrenceCount and updates the representative notification on a repeat call (P2002)', async () => {
    const prisma = makePrisma();
    prisma.notificationGroup.create.mockRejectedValue(p2002());
    prisma.notificationGroup.update.mockResolvedValue({ id: 'group-1' });
    prisma.notification.create.mockRejectedValue(p2002());
    prisma.notification.update.mockResolvedValue({ id: 'notif-1' });

    const result = await recordGroupedNotification(prisma as never, {
      userId: 'user-1',
      type: 'STORAGE_WARNING' as never,
      title: 'Storage almost full',
      body: 'You are near your storage limit.',
      groupKey: 'TYPE:STORAGE_WARNING',
    });

    expect(prisma.notificationGroup.update).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user-1', key: 'TYPE:STORAGE_WARNING' } },
      data: expect.objectContaining({ occurrenceCount: { increment: 1 } }),
    });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { groupId: 'group-1' },
      data: expect.objectContaining({ title: 'Storage almost full' }),
    });
    expect(result.created).toBe(false);
  });

  it('skips both writes when the user has disabled this notification type (IN_APP)', async () => {
    const prisma = makePrisma();
    prisma.notificationPreference.findUnique.mockResolvedValue({ enabled: false });

    const result = await recordGroupedNotification(prisma as never, {
      userId: 'user-1',
      type: 'STORAGE_WARNING' as never,
      title: 'Storage almost full',
      body: 'You are near your storage limit.',
      groupKey: 'TYPE:STORAGE_WARNING',
    });

    expect(prisma.notificationGroup.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });

  it('skips both writes when the category is disabled (Phase 5 simplified preferences)', async () => {
    const prisma = {
      ...makePrisma(),
      notificationCategoryPreference: {
        findUnique: jest.fn().mockResolvedValue({ enabled: false }),
      },
    };

    const result = await recordGroupedNotification(prisma as never, {
      userId: 'user-1',
      type: 'STORAGE_WARNING' as never,
      title: 'Storage almost full',
      body: 'You are near your storage limit.',
      groupKey: 'TYPE:STORAGE_WARNING',
    });

    expect(prisma.notificationCategoryPreference.findUnique).toHaveBeenCalledWith({
      where: {
        userId_category_channel: { userId: 'user-1', category: 'SYSTEM', channel: 'IN_APP' },
      },
    });
    expect(prisma.notificationGroup.create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });
});

describe('recordReadReceipt', () => {
  it('upserts a NotificationReadReceipt row for the given (notificationId, userId)', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { notificationReadReceipt: { upsert } };

    await recordReadReceipt(prisma as never, { notificationId: 'notif-1', userId: 'user-1' });

    expect(upsert).toHaveBeenCalledWith({
      where: { notificationId_userId: { notificationId: 'notif-1', userId: 'user-1' } },
      create: { notificationId: 'notif-1', userId: 'user-1' },
      update: { readAt: expect.any(Date) },
    });
  });

  it('tolerates being called twice for the same (notificationId, userId) without throwing', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { notificationReadReceipt: { upsert } };

    await recordReadReceipt(prisma as never, { notificationId: 'notif-1', userId: 'user-1' });
    await expect(
      recordReadReceipt(prisma as never, { notificationId: 'notif-1', userId: 'user-1' }),
    ).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
