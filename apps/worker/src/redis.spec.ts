const RedisMock = jest.fn();
jest.mock('ioredis', () => ({ Redis: RedisMock }));

describe('createRedisConnection', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    RedisMock.mockClear();
    delete process.env.REDIS_URL;
    jest.resetModules();
  });

  afterAll(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  // Regression test for the Stabilization Pass Area 3 tech-debt fix: the
  // module used to read process.env.REDIS_URL once, at module-load time
  // (`const REDIS_URL = process.env.REDIS_URL ?? '...'`), so a caller that
  // imported this module before dotenv's config() ran got the fallback
  // baked in permanently, even if REDIS_URL was set moments later. Requiring
  // the module BEFORE setting REDIS_URL, then calling createRedisConnection()
  // AFTER, is exactly the ordering that broke under the old module-scope
  // read - this test would have failed against that code.
  it('reads REDIS_URL at call time, not at the time the module was first required', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRedisConnection } = require('./redis') as typeof import('./redis');

    process.env.REDIS_URL = 'redis://set-after-require:1234';
    createRedisConnection();

    expect(RedisMock).toHaveBeenCalledWith('redis://set-after-require:1234', {
      maxRetriesPerRequest: null,
    });
  });

  it('falls back to the localhost default when REDIS_URL is unset', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRedisConnection } = require('./redis') as typeof import('./redis');

    createRedisConnection();

    expect(RedisMock).toHaveBeenCalledWith('redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  });

  it('reflects a changed REDIS_URL on a later call within the same process', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRedisConnection } = require('./redis') as typeof import('./redis');

    process.env.REDIS_URL = 'redis://first:6379';
    createRedisConnection();
    expect(RedisMock).toHaveBeenLastCalledWith('redis://first:6379', {
      maxRetriesPerRequest: null,
    });

    process.env.REDIS_URL = 'redis://second:6379';
    createRedisConnection();
    expect(RedisMock).toHaveBeenLastCalledWith('redis://second:6379', {
      maxRetriesPerRequest: null,
    });
  });
});
