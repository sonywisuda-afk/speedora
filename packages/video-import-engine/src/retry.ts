import { VideoImportError } from './errors';
import type { RetryPolicy } from './types';

export interface RetryResult<T> {
  result: T;
  retries: number;
}

// Generic exponential-backoff runner - retries only when the thrown error is
// a VideoImportError marked retryable (see errors.ts's isRetryableCategory),
// never on an unrecognized error shape. Uses the injected sleep() (a thin
// setTimeout wrapper by default), so jest.useFakeTimers() intercepts it in
// tests exactly like youtube.spec.ts's existing timeout test does.
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
): Promise<RetryResult<T>> {
  let attempt = 0;
  let delayMs = policy.baseDelayMs;

  for (;;) {
    try {
      const result = await fn();
      return { result, retries: attempt };
    } catch (error) {
      const isRetryable = error instanceof VideoImportError && error.retryable;
      const hasAttemptsLeft = attempt + 1 < policy.maxAttempts;
      if (error instanceof VideoImportError) error.retries = attempt;
      if (!isRetryable || !hasAttemptsLeft) {
        throw error;
      }
      attempt += 1;
      await sleep(delayMs);
      delayMs = Math.min(delayMs * policy.factor, policy.maxDelayMs);
    }
  }
}
