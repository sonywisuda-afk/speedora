import { Prisma } from './generated/prisma/client';
import {
  derivePipelineThreadPresentation,
  recordVideoStatusEvent,
  updateVideoStatus,
} from './video-status';

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

function makeThreadPrisma() {
  return {
    video: { update: jest.fn().mockReturnValue('video-update-promise') },
    videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
    notification: { create: jest.fn(), update: jest.fn() },
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    notificationThread: { create: jest.fn(), update: jest.fn() },
    $transaction: jest
      .fn()
      .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
  };
}

describe('recordVideoStatusEvent', () => {
  it('creates one VideoStatusEvent row with the given status and no error message', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { videoStatusEvent: { create } };

    await recordVideoStatusEvent(prisma as never, 'video-1', 'UPLOADED' as never);

    expect(create).toHaveBeenCalledWith({
      data: { videoId: 'video-1', toStatus: 'UPLOADED', errorMessage: null },
    });
  });

  it('includes an error message when given one', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { videoStatusEvent: { create } };

    await recordVideoStatusEvent(prisma as never, 'video-1', 'FAILED' as never, 'boom');

    expect(create).toHaveBeenCalledWith({
      data: { videoId: 'video-1', toStatus: 'FAILED', errorMessage: 'boom' },
    });
  });
});

describe('updateVideoStatus', () => {
  it('updates Video.status and records an event atomically via $transaction', async () => {
    const videoUpdate = jest.fn().mockReturnValue('video-update-promise');
    const eventCreate = jest.fn().mockReturnValue('event-create-promise');
    const transaction = jest.fn().mockResolvedValue([{}, {}]);
    const prisma = {
      video: { update: videoUpdate },
      videoStatusEvent: { create: eventCreate },
      $transaction: transaction,
    };

    await updateVideoStatus(prisma as never, 'video-1', 'TRANSCRIBED' as never);

    expect(videoUpdate).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: 'TRANSCRIBED' },
    });
    expect(eventCreate).toHaveBeenCalledWith({
      data: { videoId: 'video-1', toStatus: 'TRANSCRIBED', errorMessage: null },
    });
    expect(transaction).toHaveBeenCalledWith(['video-update-promise', 'event-create-promise']);
  });

  it('merges extra data fields into the same update alongside status', async () => {
    const videoUpdate = jest.fn().mockReturnValue('video-update-promise');
    const eventCreate = jest.fn().mockReturnValue('event-create-promise');
    const prisma = {
      video: { update: videoUpdate },
      videoStatusEvent: { create: eventCreate },
      $transaction: jest.fn().mockResolvedValue([{}, {}]),
    };

    await updateVideoStatus(prisma as never, 'video-1', 'UPLOADED' as never, {
      data: { transcribeProgress: 0 },
    });

    expect(videoUpdate).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { transcribeProgress: 0, status: 'UPLOADED' },
    });
  });

  it('records the error message when given one (FAILED transitions)', async () => {
    const eventCreate = jest.fn().mockReturnValue('event-create-promise');
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: eventCreate },
      $transaction: jest.fn().mockResolvedValue([{}, {}]),
    };

    await updateVideoStatus(prisma as never, 'video-1', 'FAILED' as never, {
      errorMessage: 'openai is down',
    });

    expect(eventCreate).toHaveBeenCalledWith({
      data: { videoId: 'video-1', toStatus: 'FAILED', errorMessage: 'openai is down' },
    });
  });

  it('records a RENDER_FAILED notification for the video owner on a FAILED transition', async () => {
    const notificationCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
      notification: { create: notificationCreate },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
    };

    await updateVideoStatus(prisma as never, 'video-1', 'FAILED' as never, {
      errorMessage: 'openai is down',
    });

    expect(notificationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'RENDER_FAILED',
        category: 'ERRORS',
        priority: 'ERROR',
        title: 'Proses video gagal',
        body: 'Video "My Video" gagal diproses. Silakan coba lagi.',
        videoId: 'video-1',
        clipId: null,
        metadata: { errorMessage: 'openai is down' },
      },
    });
  });

  it('forwards deps.publish into recordNotification on a FAILED transition (Milestone 04c)', async () => {
    const notificationCreate = jest.fn().mockResolvedValue({ id: 'notif-1' });
    const publish = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
      notification: { create: notificationCreate },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
    };

    await updateVideoStatus(
      prisma as never,
      'video-1',
      'FAILED' as never,
      { errorMessage: 'openai is down' },
      { publish },
    );

    expect(publish).toHaveBeenCalledWith({
      userId: 'user-1',
      notificationId: 'notif-1',
      type: 'RENDER_FAILED',
    });
  });

  it('forwards deps.enqueueDelivery into recordNotification on a FAILED transition (Milestone 04d)', async () => {
    const notificationCreate = jest.fn().mockResolvedValue({ id: 'notif-1' });
    const enqueueDelivery = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
      notification: { create: notificationCreate },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
    };

    await updateVideoStatus(
      prisma as never,
      'video-1',
      'FAILED' as never,
      { errorMessage: 'openai is down' },
      { enqueueDelivery },
    );

    expect(enqueueDelivery).toHaveBeenCalledWith({ notificationId: 'notif-1' });
  });

  it('does not touch deps.publish on a non-FAILED transition', async () => {
    const publish = jest.fn();
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
    };

    await updateVideoStatus(prisma as never, 'video-1', 'TRANSCRIBED' as never, {}, { publish });

    expect(publish).not.toHaveBeenCalled();
  });

  it('does not record a RENDER_FAILED notification when the user has disabled it', async () => {
    const notificationCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
      notification: { create: notificationCreate },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue({ enabled: false }) },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
    };

    await updateVideoStatus(prisma as never, 'video-1', 'FAILED' as never);

    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('does not record a notification for a non-FAILED transition', async () => {
    const notificationCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
      notification: { create: notificationCreate },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
    };

    await updateVideoStatus(prisma as never, 'video-1', 'TRANSCRIBED' as never);

    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('still resolves on a FAILED transition when the mocked prisma has no notification property', async () => {
    const prisma = {
      video: { update: jest.fn().mockReturnValue('video-update-promise') },
      videoStatusEvent: { create: jest.fn().mockReturnValue('event-create-promise') },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ id: 'video-1', ownerId: 'user-1', title: 'My Video' }, {}]),
    };

    await expect(
      updateVideoStatus(prisma as never, 'video-1', 'FAILED' as never),
    ).resolves.toBeUndefined();
  });

  describe('Notification Center v2 Phase 2 - Smart Timeline thread wiring', () => {
    it('creates/updates the SAME per-video thread (PIPELINE:<videoId>) on every transition, including non-FAILED ones', async () => {
      const prisma = makeThreadPrisma();
      prisma.notificationThread.create.mockResolvedValue({ id: 'thread-1' });
      prisma.notification.create.mockResolvedValue({ id: 'notif-1' });

      await updateVideoStatus(prisma as never, 'video-1', 'CLIPS_DETECTED' as never);

      expect(prisma.notificationThread.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          key: 'PIPELINE:video-1',
          videoId: 'video-1',
          status: 'IN_PROGRESS',
        }),
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'PIPELINE_PROGRESS',
          category: 'CLIP_GENERATION',
          threadId: 'thread-1',
        }),
      });
    });

    it('updates the existing thread (never a new one) on a second transition for the same video', async () => {
      const prisma = makeThreadPrisma();
      prisma.notificationThread.create.mockRejectedValue(p2002());
      prisma.notificationThread.update.mockResolvedValue({ id: 'thread-1' });
      prisma.notification.create.mockRejectedValue(p2002());
      prisma.notification.update.mockResolvedValue({ id: 'notif-1' });

      await updateVideoStatus(prisma as never, 'video-1', 'TRANSCRIBED' as never);

      expect(prisma.notificationThread.update).toHaveBeenCalledWith({
        where: { userId_key: { userId: 'user-1', key: 'PIPELINE:video-1' } },
        data: expect.objectContaining({ status: 'IN_PROGRESS' }),
      });
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { threadId: 'thread-1' },
        data: expect.objectContaining({ title: expect.any(String) }),
      });
    });

    it('marks the thread FAILED (in addition to the existing flat RENDER_FAILED notification) on a FAILED transition', async () => {
      const prisma = makeThreadPrisma();
      prisma.notificationThread.create.mockResolvedValue({ id: 'thread-1' });
      prisma.notification.create.mockResolvedValue({ id: 'notif-1' });

      await updateVideoStatus(prisma as never, 'video-1', 'FAILED' as never, {
        errorMessage: 'boom',
      });

      expect(prisma.notificationThread.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED' }),
      });
      // The flat RENDER_FAILED notification (existing, pre-Phase-2 behavior)
      // and the thread's own representative row are TWO separate
      // notification.create calls - both must still happen.
      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
      expect(prisma.notification.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({ type: 'RENDER_FAILED', videoId: 'video-1' }),
      });
      expect(prisma.notification.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ type: 'RENDER_FAILED', threadId: 'thread-1' }),
      });
    });

    it('never throws (never breaks the primary status update) when the thread write itself fails', async () => {
      const prisma = makeThreadPrisma();
      prisma.notificationThread.create.mockRejectedValue(new Error('db down'));

      await expect(
        updateVideoStatus(prisma as never, 'video-1', 'UPLOADED' as never),
      ).resolves.toBeUndefined();
    });
  });
});

describe('derivePipelineThreadPresentation', () => {
  const statuses = [
    'IMPORTING',
    'UPLOADED',
    'PENDING_SETTINGS',
    'TRANSCRIBED',
    'CLIPS_DETECTED',
    'RENDERED',
    'FAILED',
  ] as const;

  it('returns a real, non-empty title/body for every known VideoStatus (no fabricated AI sub-stages)', () => {
    for (const status of statuses) {
      const result = derivePipelineThreadPresentation(status as never, { title: 'My Video' });
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.body.length).toBeGreaterThan(0);
    }
  });

  it('reuses CLIP_READY/SUCCESS/COMPLETED for the terminal success outcome', () => {
    const result = derivePipelineThreadPresentation('RENDERED' as never, { title: 'My Video' });
    expect(result).toMatchObject({
      type: 'CLIP_READY',
      category: 'CLIP_GENERATION',
      threadStatus: 'COMPLETED',
    });
  });

  it('reuses RENDER_FAILED/ERROR/FAILED for the terminal failure outcome', () => {
    const result = derivePipelineThreadPresentation('FAILED' as never, { title: 'My Video' });
    expect(result).toMatchObject({
      type: 'RENDER_FAILED',
      category: 'ERRORS',
      threadStatus: 'FAILED',
    });
  });

  it('every non-terminal status uses PIPELINE_PROGRESS/IN_PROGRESS', () => {
    for (const status of [
      'IMPORTING',
      'UPLOADED',
      'PENDING_SETTINGS',
      'TRANSCRIBED',
      'CLIPS_DETECTED',
    ]) {
      const result = derivePipelineThreadPresentation(status as never, { title: 'My Video' });
      expect(result.type).toBe('PIPELINE_PROGRESS');
      expect(result.threadStatus).toBe('IN_PROGRESS');
    }
  });

  it('falls back to a generic "video Anda" label when the title is not known yet', () => {
    const result = derivePipelineThreadPresentation('IMPORTING' as never, { title: null });
    expect(result.title).not.toContain('null');
    expect(result.title.length).toBeGreaterThan(0);
  });

  it('throws a clear error (never returns undefined) for an unrecognized status', () => {
    expect(() =>
      derivePipelineThreadPresentation('NOT_A_REAL_STATUS' as never, { title: 'My Video' }),
    ).toThrow(/unrecognized VideoStatus/);
  });
});
