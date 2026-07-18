import { QueueName } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const discoverTelegramChatIdsMock = jest.fn();
jest.mock('@speedora/database', () => ({
  discoverTelegramChatIds: (...args: unknown[]) => discoverTelegramChatIdsMock(...args),
}));

jest.mock('../prisma', () => ({ prisma: { __brand: 'fake-prisma' } }));

const telegramChatDiscoveryQueueAddMock = jest.fn();
jest.mock('../queues', () => ({
  telegramChatDiscoveryQueue: {
    add: (...args: unknown[]) => telegramChatDiscoveryQueueAddMock(...args),
  },
}));

import {
  createTelegramChatDiscoveryWorker,
  scheduleRepeatingTrigger,
} from './telegram-chat-discovery.worker';
import { prisma } from '../prisma';

function getProcessor() {
  createTelegramChatDiscoveryWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: unknown) => Promise<unknown>;
}

describe('telegram-chat-discovery worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    discoverTelegramChatIdsMock.mockResolvedValue(undefined);
  });

  describe('scheduleRepeatingTrigger', () => {
    it('registers the repeatable trigger every 15 seconds with a fixed jobId', async () => {
      await scheduleRepeatingTrigger();

      expect(telegramChatDiscoveryQueueAddMock).toHaveBeenCalledWith(
        QueueName.TELEGRAM_CHAT_DISCOVERY,
        {},
        { repeat: { every: 15 * 1000 }, jobId: 'telegram-chat-discovery-poll' },
      );
    });
  });

  describe('processor', () => {
    it('delegates to discoverTelegramChatIds with the shared prisma client', async () => {
      const processor = getProcessor();

      await processor({});

      expect(discoverTelegramChatIdsMock).toHaveBeenCalledWith(prisma);
    });
  });
});
