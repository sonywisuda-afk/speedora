import { recordNotification } from './notification';

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
});
