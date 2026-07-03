import { validateEnv } from './env.validation';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-long-random-string',
  STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  STORAGE_REGION: 'auto',
  STORAGE_BUCKET: 'my-bucket',
  STORAGE_ACCESS_KEY_ID: 'key-id',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
};

describe('validateEnv', () => {
  it('returns without throwing when all required variables are present', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow();
  });

  it.each(Object.keys(VALID_ENV) as (keyof typeof VALID_ENV)[])(
    'throws naming %s when it is missing',
    (key) => {
      const rest = { ...VALID_ENV };
      delete rest[key];

      expect(() => validateEnv(rest)).toThrow(new RegExp(key));
    },
  );

  it('throws naming a variable that is present but empty', () => {
    expect(() => validateEnv({ ...VALID_ENV, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });

  it('lists every missing variable in a single error when several are absent', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL.*REDIS_URL.*JWT_SECRET.*STORAGE_ENDPOINT.*STORAGE_REGION.*STORAGE_BUCKET.*STORAGE_ACCESS_KEY_ID.*STORAGE_SECRET_ACCESS_KEY/s,
    );
  });

  it('does not require SENTRY_DSN', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow();
  });

  it('accepts SENTRY_DSN when present', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, SENTRY_DSN: 'https://key@o0.ingest.sentry.io/0' }),
    ).not.toThrow();
  });
});
