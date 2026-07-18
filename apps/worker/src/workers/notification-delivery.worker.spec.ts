import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const decryptWebhookUrlMock = jest.fn();
const notificationFindUniqueOrThrowMock = jest.fn();
const notificationPreferenceFindManyMock = jest.fn();
const notificationWebhookFindManyMock = jest.fn();
jest.mock('@speedora/database', () => ({
  decryptWebhookUrl: (...args: unknown[]) => decryptWebhookUrlMock(...args),
  NotificationChannel: {
    IN_APP: 'IN_APP',
    SLACK: 'SLACK',
    DISCORD: 'DISCORD',
    WEBHOOK: 'WEBHOOK',
    TELEGRAM: 'TELEGRAM',
  },
}));
jest.mock('../prisma', () => ({
  prisma: {
    notification: {
      findUniqueOrThrow: (...args: unknown[]) => notificationFindUniqueOrThrowMock(...args),
    },
    notificationPreference: {
      findMany: (...args: unknown[]) => notificationPreferenceFindManyMock(...args),
    },
    notificationWebhook: {
      findMany: (...args: unknown[]) => notificationWebhookFindManyMock(...args),
    },
  },
}));

import { createNotificationDeliveryWorker } from './notification-delivery.worker';

function getProcessor() {
  createNotificationDeliveryWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: unknown) => Promise<unknown>;
}

const baseNotification = {
  id: 'notif-1',
  userId: 'user-1',
  type: 'CLIP_READY',
  title: 'Klip siap!',
  body: 'Klip Anda sudah siap ditonton.',
  videoId: 'video-1',
  clipId: 'clip-1',
  metadata: null,
  readAt: null,
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
};

describe('notification-delivery worker', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    notificationFindUniqueOrThrowMock.mockResolvedValue(baseNotification);
    notificationPreferenceFindManyMock.mockResolvedValue([]);
    notificationWebhookFindManyMock.mockResolvedValue([]);
    decryptWebhookUrlMock.mockImplementation((stored: string) => `decrypted:${stored}`);
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
  });

  it('does nothing (zero fetch calls) when no channel is enabled for this type', async () => {
    const processor = getProcessor();

    await processor({ data: { notificationId: 'notif-1' } });

    expect(notificationPreferenceFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'CLIP_READY',
        channel: { in: ['SLACK', 'DISCORD', 'WEBHOOK', 'TELEGRAM'] },
        enabled: true,
      },
      select: { channel: true },
    });
    expect(notificationWebhookFindManyMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when enabled but no destination is configured', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([{ channel: 'SLACK' }]);
    notificationWebhookFindManyMock.mockResolvedValue([]);
    const processor = getProcessor();

    await processor({ data: { notificationId: 'notif-1' } });

    expect(notificationWebhookFindManyMock).toHaveBeenCalledWith({
      where: { userId: 'user-1', channel: { in: ['SLACK'] } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a Slack-formatted payload to the decrypted url when configured+enabled', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([{ channel: 'SLACK' }]);
    notificationWebhookFindManyMock.mockResolvedValue([
      { channel: 'SLACK', url: 'encrypted-slack-url' },
    ]);
    const processor = getProcessor();

    await processor({ data: { notificationId: 'notif-1' } });

    expect(decryptWebhookUrlMock).toHaveBeenCalledWith('encrypted-slack-url');
    expect(fetchMock).toHaveBeenCalledWith(
      'decrypted:encrypted-slack-url',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '*Klip siap!*\nKlip Anda sudah siap ditonton.' }),
      }),
    );
  });

  it('posts distinct payload shapes when two channels are both enabled and configured', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([
      { channel: 'SLACK' },
      { channel: 'DISCORD' },
    ]);
    notificationWebhookFindManyMock.mockResolvedValue([
      { channel: 'SLACK', url: 'slack-url' },
      { channel: 'DISCORD', url: 'discord-url' },
    ]);
    const processor = getProcessor();

    await processor({ data: { notificationId: 'notif-1' } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const discordBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(slackBody).toEqual({ text: '*Klip siap!*\nKlip Anda sudah siap ditonton.' });
    expect(discordBody).toEqual({ content: '**Klip siap!**\nKlip Anda sudah siap ditonton.' });
  });

  it('throws (for BullMQ to retry) and reports to Sentry on a non-2xx response', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([{ channel: 'WEBHOOK' }]);
    notificationWebhookFindManyMock.mockResolvedValue([{ channel: 'WEBHOOK', url: 'generic-url' }]);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const processor = getProcessor();

    await expect(processor({ data: { notificationId: 'notif-1' } })).rejects.toThrow(
      /failed with status 500/,
    );
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  describe('TELEGRAM (Milestone 04e)', () => {
    it('skips silently (zero fetch calls) when chatId has not been discovered yet', async () => {
      notificationPreferenceFindManyMock.mockResolvedValue([{ channel: 'TELEGRAM' }]);
      notificationWebhookFindManyMock.mockResolvedValue([
        { channel: 'TELEGRAM', url: 'encrypted-bot-token', chatId: null },
      ]);
      const processor = getProcessor();

      await processor({ data: { notificationId: 'notif-1' } });

      expect(decryptWebhookUrlMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('constructs the sendMessage URL from the decrypted bot token and posts {chat_id, text}', async () => {
      notificationPreferenceFindManyMock.mockResolvedValue([{ channel: 'TELEGRAM' }]);
      notificationWebhookFindManyMock.mockResolvedValue([
        { channel: 'TELEGRAM', url: 'encrypted-bot-token', chatId: '999888777' },
      ]);
      const processor = getProcessor();

      await processor({ data: { notificationId: 'notif-1' } });

      expect(decryptWebhookUrlMock).toHaveBeenCalledWith('encrypted-bot-token');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.telegram.org/botdecrypted:encrypted-bot-token/sendMessage',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: '999888777',
            text: 'Klip siap!\n\nKlip Anda sudah siap ditonton.',
          }),
        }),
      );
    });

    it('throws and reports to Sentry on a non-2xx sendMessage response', async () => {
      notificationPreferenceFindManyMock.mockResolvedValue([{ channel: 'TELEGRAM' }]);
      notificationWebhookFindManyMock.mockResolvedValue([
        { channel: 'TELEGRAM', url: 'encrypted-bot-token', chatId: '999888777' },
      ]);
      fetchMock.mockResolvedValue({ ok: false, status: 403 });
      const processor = getProcessor();

      await expect(processor({ data: { notificationId: 'notif-1' } })).rejects.toThrow(
        /failed with status 403/,
      );
      expect(captureExceptionMock).toHaveBeenCalled();
    });
  });
});
