import { QueueName } from '@speedora/shared';
import { Queue, Worker } from 'bullmq';

const queueGetJobCountsMock = jest.fn();
const queueGetJobsMock = jest.fn();
const queueCloseMock = jest.fn();
jest.mock('bullmq', () => ({
  Worker: jest.fn(),
  Queue: jest.fn().mockImplementation(() => ({
    getJobCounts: (...args: unknown[]) => queueGetJobCountsMock(...args),
    getJobs: (...args: unknown[]) => queueGetJobsMock(...args),
    close: (...args: unknown[]) => queueCloseMock(...args),
  })),
}));

const redisKeysMock = jest.fn();
const redisGetMock = jest.fn();
const redisTtlMock = jest.fn();
const redisQuitMock = jest.fn();
jest.mock('../redis', () => ({
  createRedisConnection: jest.fn(() => ({
    keys: (...args: unknown[]) => redisKeysMock(...args),
    get: (...args: unknown[]) => redisGetMock(...args),
    ttl: (...args: unknown[]) => redisTtlMock(...args),
    quit: (...args: unknown[]) => redisQuitMock(...args),
  })),
}));

const queueSnapshotCreateManyMock = jest.fn();
const workerHeartbeatSnapshotCreateManyMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    queueSnapshot: { createMany: (...args: unknown[]) => queueSnapshotCreateManyMock(...args) },
    workerHeartbeatSnapshot: {
      createMany: (...args: unknown[]) => workerHeartbeatSnapshotCreateManyMock(...args),
    },
  },
}));

const metricsSnapshotQueueAddMock = jest.fn();
jest.mock('../queues', () => ({
  metricsSnapshotQueue: { add: (...args: unknown[]) => metricsSnapshotQueueAddMock(...args) },
}));

import { createMetricsSnapshotWorker, scheduleRepeatingTrigger } from './metrics-snapshot.worker';

function getProcessor() {
  createMetricsSnapshotWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as () => Promise<void>;
}

const QUEUE_COUNT = Object.values(QueueName).length;

beforeEach(() => {
  jest.clearAllMocks();
  queueGetJobCountsMock.mockResolvedValue({
    waiting: 1,
    active: 2,
    completed: 10,
    failed: 1,
    delayed: 0,
    paused: 0,
  });
  queueGetJobsMock.mockResolvedValue([]);
  redisKeysMock.mockResolvedValue([]);
});

describe('scheduleRepeatingTrigger', () => {
  it('registers the repeatable trigger job', async () => {
    await scheduleRepeatingTrigger();
    expect(metricsSnapshotQueueAddMock).toHaveBeenCalledWith(
      QueueName.METRICS_SNAPSHOT,
      {},
      expect.objectContaining({ repeat: { every: expect.any(Number) } }),
    );
  });
});

describe('createMetricsSnapshotWorker processor', () => {
  it('constructs one read-only Queue per QueueName and writes one QueueSnapshot row each', async () => {
    const processor = getProcessor();
    await processor();

    expect(Queue).toHaveBeenCalledTimes(QUEUE_COUNT);
    expect(queueSnapshotCreateManyMock).toHaveBeenCalledTimes(1);
    const rows = queueSnapshotCreateManyMock.mock.calls[0][0].data;
    expect(rows).toHaveLength(QUEUE_COUNT);
    expect(rows[0]).toMatchObject({ waiting: 1, active: 2, completed: 10, failed: 1 });
  });

  it('closes every read-only Queue and the shared connection after a tick, even on success', async () => {
    const processor = getProcessor();
    await processor();

    expect(queueCloseMock).toHaveBeenCalledTimes(QUEUE_COUNT);
    expect(redisQuitMock).toHaveBeenCalledTimes(1);
  });

  it('closes the shared connection even when a tick fails partway through', async () => {
    queueSnapshotCreateManyMock.mockRejectedValueOnce(new Error('db down'));
    const processor = getProcessor();

    await expect(processor()).rejects.toThrow('db down');
    expect(redisQuitMock).toHaveBeenCalledTimes(1);
  });

  it('writes no WorkerHeartbeatSnapshot rows when no heartbeat keys exist', async () => {
    redisKeysMock.mockResolvedValue([]);
    const processor = getProcessor();
    await processor();

    expect(workerHeartbeatSnapshotCreateManyMock).not.toHaveBeenCalled();
  });

  it('writes a WorkerHeartbeatSnapshot row per valid heartbeat, summing job counts across its queues', async () => {
    redisKeysMock.mockResolvedValue(['speedora:worker:heartbeat:worker-light']);
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        workerId: 'worker-light',
        queues: [QueueName.PROBE_VIDEO, QueueName.TRANSCRIBE],
        startedAt: '2026-08-02T00:00:00.000Z',
      }),
    );
    redisTtlMock.mockResolvedValue(40);

    const processor = getProcessor();
    await processor();

    expect(workerHeartbeatSnapshotCreateManyMock).toHaveBeenCalledTimes(1);
    const rows = workerHeartbeatSnapshotCreateManyMock.mock.calls[0][0].data;
    expect(rows).toEqual([
      {
        workerId: 'worker-light',
        queues: [QueueName.PROBE_VIDEO, QueueName.TRANSCRIBE],
        // Summed across both queues: active 2+2=4, waiting 1+1=2 (every
        // mocked queue returns the same {waiting:1, active:2, ...}).
        jobsActive: 4,
        jobsWaiting: 2,
        workerStartedAt: new Date('2026-08-02T00:00:00.000Z'),
        heartbeatTtlSeconds: 40,
      },
    ]);
  });

  it('skips a heartbeat key whose value expired between the KEYS scan and the GET (returns null)', async () => {
    redisKeysMock.mockResolvedValue(['speedora:worker:heartbeat:worker-gone']);
    redisGetMock.mockResolvedValue(null);
    redisTtlMock.mockResolvedValue(-2);

    const processor = getProcessor();
    await processor();

    expect(workerHeartbeatSnapshotCreateManyMock).not.toHaveBeenCalled();
  });

  it('skips a malformed heartbeat value rather than throwing', async () => {
    redisKeysMock.mockResolvedValue(['speedora:worker:heartbeat:bad']);
    redisGetMock.mockResolvedValue('not json');
    redisTtlMock.mockResolvedValue(30);

    const processor = getProcessor();
    await expect(processor()).resolves.toBeUndefined();
    expect(workerHeartbeatSnapshotCreateManyMock).not.toHaveBeenCalled();
  });
});
