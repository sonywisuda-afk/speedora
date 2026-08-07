import { isNarrativeGraphEnabled } from './feature-flags';

describe('isNarrativeGraphEnabled', () => {
  const original = process.env.NARRATIVE_GRAPH_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.NARRATIVE_GRAPH_ENABLED;
    else process.env.NARRATIVE_GRAPH_ENABLED = original;
  });

  it('is false when the env var is unset', () => {
    delete process.env.NARRATIVE_GRAPH_ENABLED;
    expect(isNarrativeGraphEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env.NARRATIVE_GRAPH_ENABLED = '1';
    expect(isNarrativeGraphEnabled()).toBe(false);
    process.env.NARRATIVE_GRAPH_ENABLED = 'TRUE';
    expect(isNarrativeGraphEnabled()).toBe(false);
  });

  it('is true when explicitly set to "true"', () => {
    process.env.NARRATIVE_GRAPH_ENABLED = 'true';
    expect(isNarrativeGraphEnabled()).toBe(true);
  });
});
