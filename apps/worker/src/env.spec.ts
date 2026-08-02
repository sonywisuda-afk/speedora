import { validateEnv } from './env';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  GROQ_API_KEY: 'gsk-test',
  STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  STORAGE_REGION: 'auto',
  STORAGE_BUCKET: 'my-bucket',
  STORAGE_ACCESS_KEY_ID: 'key-id',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
} as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('does not throw when all required variables are present', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow();
  });

  it.each(Object.keys(VALID_ENV))('throws naming %s when it is missing', (key) => {
    const rest = { ...VALID_ENV };
    delete rest[key];

    expect(() => validateEnv(rest as NodeJS.ProcessEnv)).toThrow(new RegExp(key));
  });

  it('lists every missing variable in a single error when several are absent', () => {
    expect(() => validateEnv({} as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL.*REDIS_URL.*GROQ_API_KEY.*STORAGE_ENDPOINT.*STORAGE_REGION.*STORAGE_BUCKET.*STORAGE_ACCESS_KEY_ID.*STORAGE_SECRET_ACCESS_KEY/,
    );
  });

  it('does not require OPENAI_API_KEY (only the paid premium tier needs it)', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow(/OPENAI_API_KEY/);
  });

  it('does not require FFMPEG_PATH (it has its own default elsewhere)', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow(/FFMPEG_PATH/);
  });

  it('does not require WORKER_QUEUES (unset means every queue runs)', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow(/WORKER_QUEUES/);
  });

  it('accepts a valid WORKER_QUEUES value', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, WORKER_QUEUES: 'render-clip,detect-clips' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('throws naming the bad value(s) when WORKER_QUEUES has an unknown queue name', () => {
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        WORKER_QUEUES: 'render-clip,not-a-real-queue',
      } as NodeJS.ProcessEnv),
    ).toThrow(/not-a-real-queue/);
  });

  it('does not require WORKER_HEARTBEAT_INTERVAL_MS/WORKER_HEARTBEAT_TTL_SECONDS', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow(/WORKER_HEARTBEAT/);
  });

  it('accepts valid WORKER_HEARTBEAT_INTERVAL_MS/WORKER_HEARTBEAT_TTL_SECONDS values', () => {
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        WORKER_HEARTBEAT_INTERVAL_MS: '5000',
        WORKER_HEARTBEAT_TTL_SECONDS: '20',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('throws on a non-numeric WORKER_HEARTBEAT_INTERVAL_MS (PR #42 review finding: used to reach setInterval(fn, NaN) silently)', () => {
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        WORKER_HEARTBEAT_INTERVAL_MS: 'garbage',
      } as NodeJS.ProcessEnv),
    ).toThrow(/WORKER_HEARTBEAT_INTERVAL_MS/);
  });

  it('throws when WORKER_HEARTBEAT_TTL_SECONDS would expire at or before the next beat', () => {
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        WORKER_HEARTBEAT_INTERVAL_MS: '20000',
        WORKER_HEARTBEAT_TTL_SECONDS: '15',
      } as NodeJS.ProcessEnv),
    ).toThrow(/must be greater than/);
  });
});
