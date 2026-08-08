import { isMultimodalReasoningEnabled } from './feature-flags';

describe('isMultimodalReasoningEnabled', () => {
  const original = process.env.MULTIMODAL_REASONING_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.MULTIMODAL_REASONING_ENABLED;
    else process.env.MULTIMODAL_REASONING_ENABLED = original;
  });

  it('is false when the env var is unset', () => {
    delete process.env.MULTIMODAL_REASONING_ENABLED;
    expect(isMultimodalReasoningEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env.MULTIMODAL_REASONING_ENABLED = '1';
    expect(isMultimodalReasoningEnabled()).toBe(false);
    process.env.MULTIMODAL_REASONING_ENABLED = 'TRUE';
    expect(isMultimodalReasoningEnabled()).toBe(false);
  });

  it('is true when explicitly set to "true"', () => {
    process.env.MULTIMODAL_REASONING_ENABLED = 'true';
    expect(isMultimodalReasoningEnabled()).toBe(true);
  });
});
