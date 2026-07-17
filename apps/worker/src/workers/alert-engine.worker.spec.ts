import { QueueName } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const getBucketUsageMock = jest.fn();
jest.mock('@speedora/storage', () => ({
  getBucketUsage: (...args: unknown[]) => getBucketUsageMock(...args),
}));

const publishNotificationMock = jest.fn();
jest.mock('../notificationPublisher', () => ({
  publishNotification: (...args: unknown[]) => publishNotificationMock(...args),
}));

const alertStateFindUniqueMock = jest.fn();
const alertStateCreateMock = jest.fn();
const alertStateDeleteMock = jest.fn();
const notificationCreateMock = jest.fn();
const notificationPreferenceFindUniqueMock = jest.fn();
const userFindManyMock = jest.fn();
const premiumCreditFindManyMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    alertState: {
      findUnique: (...args: unknown[]) => alertStateFindUniqueMock(...args),
      create: (...args: unknown[]) => alertStateCreateMock(...args),
      delete: (...args: unknown[]) => alertStateDeleteMock(...args),
    },
    notification: { create: (...args: unknown[]) => notificationCreateMock(...args) },
    notificationPreference: {
      findUnique: (...args: unknown[]) => notificationPreferenceFindUniqueMock(...args),
    },
    user: { findMany: (...args: unknown[]) => userFindManyMock(...args) },
    premiumCredit: { findMany: (...args: unknown[]) => premiumCreditFindManyMock(...args) },
  },
}));

const alertEngineQueueAddMock = jest.fn();
jest.mock('../queues', () => ({
  alertEngineQueue: { add: (...args: unknown[]) => alertEngineQueueAddMock(...args) },
}));

import { createAlertEngineWorker, scheduleRepeatingTrigger } from './alert-engine.worker';

function getProcessor() {
  createAlertEngineWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: unknown) => Promise<unknown>;
}

describe('alert-engine worker', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.STORAGE_QUOTA_BYTES;
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
    notificationCreateMock.mockResolvedValue({ id: 'notif-1' });
    publishNotificationMock.mockResolvedValue(undefined);
    alertStateFindUniqueMock.mockResolvedValue(null);
    alertStateCreateMock.mockResolvedValue({});
    getBucketUsageMock.mockResolvedValue({
      objectCount: 10,
      totalSizeBytes: 100,
      truncated: false,
    });
    premiumCreditFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('scheduleRepeatingTrigger', () => {
    it('registers the repeatable trigger with a fixed jobId', async () => {
      await scheduleRepeatingTrigger();

      expect(alertEngineQueueAddMock).toHaveBeenCalledWith(
        QueueName.ALERT_ENGINE,
        {},
        { repeat: { every: 30 * 60 * 1000 }, jobId: 'alert-engine-poll' },
      );
    });
  });

  describe('processor - storage warning', () => {
    it('notifies every ops-role user when usage exceeds the quota', async () => {
      process.env.STORAGE_QUOTA_BYTES = '1000';
      getBucketUsageMock.mockResolvedValue({
        objectCount: 5,
        totalSizeBytes: 900,
        truncated: false,
      });
      userFindManyMock.mockResolvedValue([{ id: 'admin-1' }, { id: 'ops-1' }]);

      const processor = getProcessor();
      await processor({});

      expect(userFindManyMock).toHaveBeenCalledWith({
        where: { role: { in: ['ADMIN', 'AI_ENGINEER', 'OPERATOR'] } },
        select: { id: true },
      });
      expect(notificationCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'admin-1', type: 'STORAGE_WARNING' }),
      });
      expect(notificationCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'ops-1', type: 'STORAGE_WARNING' }),
      });
      expect(publishNotificationMock).toHaveBeenCalledTimes(2);
    });

    it('does not resolve recipients or notify when usage is under quota', async () => {
      process.env.STORAGE_QUOTA_BYTES = '1000';
      getBucketUsageMock.mockResolvedValue({
        objectCount: 5,
        totalSizeBytes: 100,
        truncated: false,
      });

      const processor = getProcessor();
      await processor({});

      expect(userFindManyMock).not.toHaveBeenCalled();
      expect(notificationCreateMock).not.toHaveBeenCalled();
    });

    it('never breaches when STORAGE_QUOTA_BYTES is unset, even though usage is still fetched', async () => {
      getBucketUsageMock.mockResolvedValue({
        objectCount: 999,
        totalSizeBytes: 999999999999,
        truncated: true,
      });

      const processor = getProcessor();
      await processor({});

      expect(getBucketUsageMock).toHaveBeenCalled();
      expect(notificationCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('processor - credit warning', () => {
    it('notifies only the user whose unspent PAID credit count is 0', async () => {
      premiumCreditFindManyMock.mockResolvedValue([
        { userId: 'user-1', videoId: null }, // still has one unspent credit
        { userId: 'user-2', videoId: 'video-1' }, // spent their only credit - out
      ]);

      const processor = getProcessor();
      await processor({});

      expect(notificationCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-2', type: 'CREDIT_WARNING' }),
      });
      expect(notificationCreateMock).not.toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }),
      });
    });

    it('does not notify a user who has never purchased premium credit', async () => {
      premiumCreditFindManyMock.mockResolvedValue([]);

      const processor = getProcessor();
      await processor({});

      expect(notificationCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('de-dup across ticks', () => {
    it('does not re-notify on a second tick while still breached', async () => {
      process.env.STORAGE_QUOTA_BYTES = '1000';
      getBucketUsageMock.mockResolvedValue({
        objectCount: 5,
        totalSizeBytes: 900,
        truncated: false,
      });
      userFindManyMock.mockResolvedValue([{ id: 'admin-1' }]);
      // First tick creates the AlertState row; simulate the second tick
      // seeing it already exist.
      alertStateFindUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
        dedupeKey: 'storage-warning',
      });

      const processor = getProcessor();
      await processor({});
      await processor({});

      expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    });
  });
});
