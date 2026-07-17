import { recordVideoStatusEvent, updateVideoStatus } from './video-status';

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
});
