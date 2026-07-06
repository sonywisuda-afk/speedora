import { predictPerformance } from './predict';

describe('predictPerformance', () => {
  it('returns uncertain with a clear rationale when highlightScore is null', () => {
    const result = predictPerformance(null, 0);
    expect(result.bucket).toBe('uncertain');
    expect(result.rationale).toContain('No signals');
  });

  it('returns uncertain when confidence is below the trust threshold, even with a high score', () => {
    const result = predictPerformance(90, 0.2);
    expect(result.bucket).toBe('uncertain');
    expect(result.rationale).toContain('low');
  });

  it('returns likely_high_performer for a high score with sufficient confidence', () => {
    const result = predictPerformance(80, 0.8);
    expect(result.bucket).toBe('likely_high_performer');
  });

  it('returns likely_low_performer for a low score with sufficient confidence', () => {
    const result = predictPerformance(20, 0.8);
    expect(result.bucket).toBe('likely_low_performer');
  });

  it('returns uncertain for a middle-range score with sufficient confidence', () => {
    const result = predictPerformance(50, 0.8);
    expect(result.bucket).toBe('uncertain');
  });
});
