import { CANDIDATE_EXPANSION_POOL_SIZE, isCandidateExpansionEnabled } from './feature-flags';

describe('isCandidateExpansionEnabled', () => {
  const original = process.env.CANDIDATE_EXPANSION_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.CANDIDATE_EXPANSION_ENABLED;
    else process.env.CANDIDATE_EXPANSION_ENABLED = original;
  });

  it('is false when the env var is unset', () => {
    delete process.env.CANDIDATE_EXPANSION_ENABLED;
    expect(isCandidateExpansionEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env.CANDIDATE_EXPANSION_ENABLED = '1';
    expect(isCandidateExpansionEnabled()).toBe(false);
    process.env.CANDIDATE_EXPANSION_ENABLED = 'TRUE';
    expect(isCandidateExpansionEnabled()).toBe(false);
  });

  it('is true when explicitly set to "true"', () => {
    process.env.CANDIDATE_EXPANSION_ENABLED = 'true';
    expect(isCandidateExpansionEnabled()).toBe(true);
  });
});

describe('CANDIDATE_EXPANSION_POOL_SIZE', () => {
  it("is the Clip Ranking Engine funnel's Stage A pool size target (>= 30)", () => {
    expect(CANDIDATE_EXPANSION_POOL_SIZE).toBeGreaterThanOrEqual(30);
  });
});
