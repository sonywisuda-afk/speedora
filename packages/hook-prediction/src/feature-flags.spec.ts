import { isHookPredictionEnabled } from './feature-flags';

describe('isHookPredictionEnabled', () => {
  const original = process.env.HOOK_PREDICTION_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.HOOK_PREDICTION_ENABLED;
    else process.env.HOOK_PREDICTION_ENABLED = original;
  });

  it('is false when the env var is unset', () => {
    delete process.env.HOOK_PREDICTION_ENABLED;
    expect(isHookPredictionEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env.HOOK_PREDICTION_ENABLED = '1';
    expect(isHookPredictionEnabled()).toBe(false);
    process.env.HOOK_PREDICTION_ENABLED = 'TRUE';
    expect(isHookPredictionEnabled()).toBe(false);
  });

  it('is true when explicitly set to "true"', () => {
    process.env.HOOK_PREDICTION_ENABLED = 'true';
    expect(isHookPredictionEnabled()).toBe(true);
  });
});
