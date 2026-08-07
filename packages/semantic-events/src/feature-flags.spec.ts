import { isSemanticEventDetectionEnabled } from './feature-flags';

describe('isSemanticEventDetectionEnabled', () => {
  const original = process.env.SEMANTIC_EVENT_DETECTION_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.SEMANTIC_EVENT_DETECTION_ENABLED;
    else process.env.SEMANTIC_EVENT_DETECTION_ENABLED = original;
  });

  it('is false when the env var is unset', () => {
    delete process.env.SEMANTIC_EVENT_DETECTION_ENABLED;
    expect(isSemanticEventDetectionEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env.SEMANTIC_EVENT_DETECTION_ENABLED = '1';
    expect(isSemanticEventDetectionEnabled()).toBe(false);
    process.env.SEMANTIC_EVENT_DETECTION_ENABLED = 'TRUE';
    expect(isSemanticEventDetectionEnabled()).toBe(false);
  });

  it('is true when explicitly set to "true"', () => {
    process.env.SEMANTIC_EVENT_DETECTION_ENABLED = 'true';
    expect(isSemanticEventDetectionEnabled()).toBe(true);
  });
});
