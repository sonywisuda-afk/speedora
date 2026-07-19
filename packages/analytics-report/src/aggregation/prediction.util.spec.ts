import { predictEngagement, type PredictionPair } from './prediction.util';

// 20 pairs with a clean, strong linear relationship:
// engagementScore = 0.01 * highlightScore + 0.05
const STRONG_LINEAR_HISTORY: PredictionPair[] = Array.from({ length: 20 }, (_, i) => ({
  highlightScore: i * 4,
  engagementScore: 0.01 * (i * 4) + 0.05,
}));

// 20 pairs with no relationship at all (constant engagementScore - zero
// variance in y, so pearsonCorrelation must return null). Uses an exactly
// representable float (0.5, a power-of-two fraction) - an inexact constant
// like 0.2 leaves tiny IEEE754 residue in the variance sum, which would
// make this test flaky rather than actually exercising the zero-variance
// path (same reason packages/dataset-quality's own correlation.spec.ts
// uses plain integers for this exact case).
const NO_VARIANCE_HISTORY: PredictionPair[] = Array.from({ length: 20 }, (_, i) => ({
  highlightScore: i * 4,
  engagementScore: 0.5,
}));

describe('predictEngagement', () => {
  it('is unavailable when the clip itself has no highlightScore yet', () => {
    const result = predictEngagement(null, STRONG_LINEAR_HISTORY);

    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.predictedEngagementScore).toBeNull();
  });

  it('is unavailable with fewer than 20 historical samples, and reports the real count', () => {
    const result = predictEngagement(50, STRONG_LINEAR_HISTORY.slice(0, 5));

    expect(result.available).toBe(false);
    expect(result.sampleCount).toBe(5);
    expect(result.minSamplesRequired).toBe(20);
    expect(result.reason).toContain('5/20');
  });

  it('is unavailable when there is no meaningful correlation (zero variance in outcomes)', () => {
    const result = predictEngagement(50, NO_VARIANCE_HISTORY);

    expect(result.available).toBe(false);
    expect(result.correlation).toBeNull();
    expect(result.predictedEngagementScore).toBeNull();
  });

  it('produces a real correlation and a linear-regression prediction with >= 20 correlated samples', () => {
    const result = predictEngagement(40, STRONG_LINEAR_HISTORY);

    expect(result.available).toBe(true);
    expect(result.sampleCount).toBe(20);
    expect(result.correlation).toBeCloseTo(1, 5);
    // engagementScore = 0.01 * 40 + 0.05 = 0.45
    expect(result.predictedEngagementScore).toBeCloseTo(0.45, 5);
  });

  it('never predicts a negative engagementScore, even for a highlightScore far outside the training range', () => {
    // A history with a negative slope, projected far past its range, would
    // otherwise go negative - engagementScore is a non-negative ratio.
    const decreasingHistory: PredictionPair[] = Array.from({ length: 20 }, (_, i) => ({
      highlightScore: i * 4,
      engagementScore: 1 - 0.01 * (i * 4),
    }));

    const result = predictEngagement(1000, decreasingHistory);

    expect(result.available).toBe(true);
    expect(result.predictedEngagementScore).toBeGreaterThanOrEqual(0);
  });
});
