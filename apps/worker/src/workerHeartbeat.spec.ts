import { heartbeatKey, QueueName, type WorkerHeartbeatPayload } from '@speedora/shared';
import {
  InvalidWorkerHeartbeatConfigError,
  resolveHeartbeatOptions,
  resolveWorkerId,
  startWorkerHeartbeat,
} from './workerHeartbeat';

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

// PR #42 review finding, fixed here: beat()/stop() used to leave a failed
// redis.set()/redis.del() as an unhandled promise rejection.
describe('startWorkerHeartbeat error handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('logs and does not throw/reject when a heartbeat write fails', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const redis = {
      set: jest.fn().mockRejectedValue(new Error('connection reset')),
      del: jest.fn().mockResolvedValue(1),
    };

    const handle = startWorkerHeartbeat(redis as never, 'worker-render', [QueueName.RENDER_CLIP]);
    // Fake timers don't fake the microtask queue - flush it so the rejected
    // beat()'s own try/catch actually runs before we assert on it.
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleWarn).toHaveBeenCalled();
    expect(consoleWarn.mock.calls[0][0]).toContain('heartbeat write failed');

    void handle.stop();
  });

  it('keeps ticking on the next interval after a failed beat', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const redis = {
      set: jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const handle = startWorkerHeartbeat(redis as never, 'worker-render', [QueueName.RENDER_CLIP], {
      intervalMs: 1000,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(redis.set).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(redis.set).toHaveBeenCalledTimes(2);

    void handle.stop();
  });

  it('stop() logs and resolves (does not reject) when redis.del fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockRejectedValue(new Error('connection closed')),
    };

    const handle = startWorkerHeartbeat(redis as never, 'worker-render', [QueueName.RENDER_CLIP]);
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});

describe('resolveHeartbeatOptions', () => {
  it('returns the documented defaults when both vars are unset', () => {
    expect(resolveHeartbeatOptions({} as NodeJS.ProcessEnv)).toEqual({
      intervalMs: 15_000,
      ttlSeconds: 45,
    });
  });

  it('uses valid overrides for both', () => {
    expect(
      resolveHeartbeatOptions({
        WORKER_HEARTBEAT_INTERVAL_MS: '5000',
        WORKER_HEARTBEAT_TTL_SECONDS: '20',
      } as NodeJS.ProcessEnv),
    ).toEqual({ intervalMs: 5000, ttlSeconds: 20 });
  });

  it('throws InvalidWorkerHeartbeatConfigError for a non-numeric interval', () => {
    expect(() =>
      resolveHeartbeatOptions({ WORKER_HEARTBEAT_INTERVAL_MS: 'garbage' } as NodeJS.ProcessEnv),
    ).toThrow(InvalidWorkerHeartbeatConfigError);
  });

  it('throws for a zero or negative TTL', () => {
    expect(() =>
      resolveHeartbeatOptions({ WORKER_HEARTBEAT_TTL_SECONDS: '0' } as NodeJS.ProcessEnv),
    ).toThrow(InvalidWorkerHeartbeatConfigError);
    expect(() =>
      resolveHeartbeatOptions({ WORKER_HEARTBEAT_TTL_SECONDS: '-5' } as NodeJS.ProcessEnv),
    ).toThrow(InvalidWorkerHeartbeatConfigError);
  });

  it('throws when the TTL would expire at or before the next beat', () => {
    expect(() =>
      resolveHeartbeatOptions({
        WORKER_HEARTBEAT_INTERVAL_MS: '20000',
        WORKER_HEARTBEAT_TTL_SECONDS: '15',
      } as NodeJS.ProcessEnv),
    ).toThrow(/must be greater than/);
  });

  it('treats an empty/whitespace-only value the same as unset', () => {
    expect(
      resolveHeartbeatOptions({ WORKER_HEARTBEAT_INTERVAL_MS: '  ' } as NodeJS.ProcessEnv)
        .intervalMs,
    ).toBe(15_000);
  });
});
