const initMock = jest.fn();
jest.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => initMock(...args),
}));

import { initSentry } from './sentry';

describe('initSentry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('initializes Sentry with the DSN from the environment', () => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    process.env.NODE_ENV = 'production';

    initSentry();

    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o0.ingest.sentry.io/0',
        environment: 'production',
        sendDefaultPii: false,
      }),
    );
  });

  it('still calls init (as a no-op SDK) when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;

    initSentry();

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ dsn: undefined }));
  });
});
