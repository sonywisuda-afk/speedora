import { TurnstileCaptchaProvider } from './turnstile-captcha.provider';

describe('TurnstileCaptchaProvider', () => {
  let provider: TurnstileCaptchaProvider;
  const originalSecretKey = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new TurnstileCaptchaProvider();
  });

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = originalSecretKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('skips verification and returns true when TURNSTILE_SECRET_KEY is not configured', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    global.fetch = jest.fn();

    const result = await provider.verify('token', '127.0.0.1');

    expect(result).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns true when Cloudflare reports success', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    });

    const result = await provider.verify('token', '127.0.0.1');

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ secret: 'test-secret', response: 'token', remoteip: '127.0.0.1' }),
      }),
    );
  });

  it('returns false when Cloudflare reports failure', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false }),
    });

    const result = await provider.verify('bad-token', '127.0.0.1');

    expect(result).toBe(false);
  });

  it('fails closed when the verification request itself fails', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const result = await provider.verify('token', '127.0.0.1');

    expect(result).toBe(false);
  });
});
