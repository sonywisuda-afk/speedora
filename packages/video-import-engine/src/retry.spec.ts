import { VideoImportError } from './errors';
import { withRetry } from './retry';

function retryableError(): VideoImportError {
  return new VideoImportError('boom', { category: 'network', engineName: 'test' });
}

describe('withRetry', () => {
  it('returns the result and retries:0 on first-attempt success', async () => {
    const sleep = jest.fn(async () => undefined);
    const fn = jest.fn(async () => 'ok');

    const { result, retries } = await withRetry(
      fn,
      { maxAttempts: 3, baseDelayMs: 10, factor: 2, maxDelayMs: 100 },
      sleep,
    );

    expect(result).toBe('ok');
    expect(retries).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a retryable failure with exponential backoff until it succeeds', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fn = jest.fn(async () => {
      call += 1;
      if (call < 3) throw retryableError();
      return 'ok';
    });

    const { result, retries } = await withRetry(
      fn,
      { maxAttempts: 5, baseDelayMs: 10, factor: 2, maxDelayMs: 100 },
      sleep,
    );

    expect(result).toBe('ok');
    expect(retries).toBe(2);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('gives up once maxAttempts is exhausted, throwing the last error with retries set', async () => {
    const sleep = jest.fn(async () => undefined);
    const error = retryableError();
    const fn = jest.fn(async () => {
      throw error;
    });

    await expect(
      withRetry(fn, { maxAttempts: 2, baseDelayMs: 5, factor: 2, maxDelayMs: 100 }, sleep),
    ).rejects.toBe(error);
    expect(error.retries).toBe(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error, even with attempts remaining', async () => {
    const sleep = jest.fn(async () => undefined);
    const error = new VideoImportError('nope', { category: 'unsupported', engineName: 'test' });
    const fn = jest.fn(async () => {
      throw error;
    });

    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 5, factor: 2, maxDelayMs: 100 }, sleep),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry an error that is not a VideoImportError at all', async () => {
    const sleep = jest.fn(async () => undefined);
    const error = new Error('plain error');
    const fn = jest.fn(async () => {
      throw error;
    });

    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 5, factor: 2, maxDelayMs: 100 }, sleep),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caps backoff delay at maxDelayMs', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fn = jest.fn(async () => {
      call += 1;
      if (call < 4) throw retryableError();
      return 'ok';
    });

    await withRetry(fn, { maxAttempts: 5, baseDelayMs: 10, factor: 3, maxDelayMs: 25 }, sleep);

    expect(sleep.mock.calls).toEqual([[10], [25], [25]]);
  });
});
