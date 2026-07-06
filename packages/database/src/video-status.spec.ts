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
});
