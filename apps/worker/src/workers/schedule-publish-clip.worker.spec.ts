import { PublishStatus } from '@viral-clip-app/database';
import { QueueName } from '@viral-clip-app/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const publishRecordFindManyMock = jest.fn();
const publishRecordUpdateManyMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    publishRecord: {
      findMany: (...args: unknown[]) => publishRecordFindManyMock(...args),
      updateMany: (...args: unknown[]) => publishRecordUpdateManyMock(...args),
    },
  },
}));

const publishClipQueueAddMock = jest.fn();
const schedulePublishClipQueueAddMock = jest.fn();
jest.mock('../queues', () => ({
  publishClipQueue: { add: (...args: unknown[]) => publishClipQueueAddMock(...args) },
  schedulePublishClipQueue: {
    add: (...args: unknown[]) => schedulePublishClipQueueAddMock(...args),
  },
}));

import {
  createSchedulePublishClipWorker,
  scheduleRepeatingTrigger,
} from './schedule-publish-clip.worker';

function getProcessor() {
  createSchedulePublishClipWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: unknown) => Promise<unknown>;
}

describe('schedule-publish-clip worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publishRecordFindManyMock.mockResolvedValue([]);
    publishRecordUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  describe('scheduleRepeatingTrigger', () => {
    it('registers the repeatable trigger with a fixed jobId (idempotent across restarts)', async () => {
      await scheduleRepeatingTrigger();

      expect(schedulePublishClipQueueAddMock).toHaveBeenCalledWith(
        QueueName.SCHEDULE_PUBLISH_CLIP,
        {},
        { repeat: { every: 60_000 }, jobId: 'schedule-publish-clip-poll' },
      );
    });
  });

  describe('processor', () => {
    it('queries for SCHEDULED records due now, claims each atomically, and enqueues publish-clip', async () => {
      publishRecordFindManyMock.mockResolvedValue([{ id: 'record-1' }, { id: 'record-2' }]);
      publishRecordUpdateManyMock.mockResolvedValue({ count: 1 });

      const processor = getProcessor();
      await processor({});

      expect(publishRecordFindManyMock).toHaveBeenCalledWith({
        where: { status: PublishStatus.SCHEDULED, scheduledAt: { lte: expect.any(Date) } },
        select: { id: true },
      });
      expect(publishRecordUpdateManyMock).toHaveBeenCalledWith({
        where: { id: 'record-1', status: PublishStatus.SCHEDULED },
        data: { status: PublishStatus.QUEUED },
      });
      expect(publishRecordUpdateManyMock).toHaveBeenCalledWith({
        where: { id: 'record-2', status: PublishStatus.SCHEDULED },
        data: { status: PublishStatus.QUEUED },
      });
      expect(publishClipQueueAddMock).toHaveBeenCalledWith(
        QueueName.PUBLISH_CLIP,
        { publishRecordId: 'record-1' },
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );
      expect(publishClipQueueAddMock).toHaveBeenCalledWith(
        QueueName.PUBLISH_CLIP,
        { publishRecordId: 'record-2' },
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );
      expect(publishClipQueueAddMock).toHaveBeenCalledTimes(2);
    });

    it('does not enqueue a record that failed to be atomically claimed (already claimed elsewhere)', async () => {
      publishRecordFindManyMock.mockResolvedValue([{ id: 'record-1' }]);
      publishRecordUpdateManyMock.mockResolvedValue({ count: 0 });

      const processor = getProcessor();
      await processor({});

      expect(publishClipQueueAddMock).not.toHaveBeenCalled();
    });

    it('does nothing when there are no due records', async () => {
      publishRecordFindManyMock.mockResolvedValue([]);

      const processor = getProcessor();
      await processor({});

      expect(publishRecordUpdateManyMock).not.toHaveBeenCalled();
      expect(publishClipQueueAddMock).not.toHaveBeenCalled();
    });
  });
});
