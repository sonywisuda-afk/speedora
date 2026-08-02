import { heartbeatKey, QueueName, type WorkerHeartbeatPayload } from '@speedora/shared';
import { resolveWorkerId, startWorkerHeartbeat } from './workerHeartbeat';

function createRedisStub() {
  return {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };
}

describe('resolveWorkerId', () => {
  it('uses WORKER_ID when set', () => {
    expect(resolveWorkerId({ WORKER_ID: 'worker-render' } as NodeJS.ProcessEnv)).toBe(
      'worker-render',
    );
  });

  it('falls back to hostname-pid when WORKER_ID is unset', () => {
    const id = resolveWorkerId({} as NodeJS.ProcessEnv);
    expect(id).toMatch(/^.+-\d+$/);
  });
});

describe('startWorkerHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes an initial heartbeat immediately with the given TTL', () => {
    const redis = createRedisStub();
    const handle = startWorkerHeartbeat(redis as never, 'worker-render', [QueueName.RENDER_CLIP], {
      ttlSeconds: 45,
    });

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, exFlag, ttl] = redis.set.mock.calls[0];
    expect(key).toBe(heartbeatKey('worker-render'));
    expect(exFlag).toBe('EX');
    expect(ttl).toBe(45);

    const payload = JSON.parse(value) as WorkerHeartbeatPayload;
    expect(payload.workerId).toBe('worker-render');
    expect(payload.queues).toEqual([QueueName.RENDER_CLIP]);
    expect(typeof payload.startedAt).toBe('string');

    void handle.stop();
  });

  it('re-sends the heartbeat on every interval tick', () => {
    const redis = createRedisStub();
    const handle = startWorkerHeartbeat(redis as never, 'worker-render', [QueueName.RENDER_CLIP], {
      intervalMs: 1000,
    });

    expect(redis.set).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3500);
    expect(redis.set).toHaveBeenCalledTimes(4);

    void handle.stop();
  });

  it('stop() clears the interval and deletes the key', async () => {
    const redis = createRedisStub();
    const handle = startWorkerHeartbeat(redis as never, 'worker-render', [QueueName.RENDER_CLIP], {
      intervalMs: 1000,
    });

    await handle.stop();
    expect(redis.del).toHaveBeenCalledWith(heartbeatKey('worker-render'));

    redis.set.mockClear();
    jest.advanceTimersByTime(5000);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
