import type { FusionBreakdown, FusionFactor } from '@speedora/shared';
import { generateClipNarrative } from './clip-narrative.util';

function factor(overrides: Partial<FusionFactor> = {}): FusionFactor {
  return {
    signal: 'audio',
    feature: 'averageRmsDb',
    weightedContribution: 0.2,
    description: 'Loud, energetic audio',
    ...overrides,
  };
}

function contribution(overrides: Partial<FusionBreakdown[number]> = {}): FusionBreakdown[number] {
  return {
    signal: 'audio',
    feature: 'averageRmsDb',
    rawValue: -18,
    normalizedValue: 0.7,
    weight: 0.35,
    weightedContribution: 0.245,
    ...overrides,
  };
}

// A baseline history with a clean median of 0.30 (sorted: 0.2, 0.25, 0.3, 0.35, 0.4).
const BASELINE_HISTORY = [0.4, 0.2, 0.35, 0.25, 0.3];

describe('generateClipNarrative', () => {
  it("returns 'not_enough_data' when the clip itself has no real outcome yet", () => {
    const result = generateClipNarrative(
      { topFactors: [factor()], breakdown: [contribution()] },
      { engagementScore: null, ownerEngagementScores: BASELINE_HISTORY },
    );

    expect(result.classification).toBe('not_enough_data');
    expect(result.comparedAgainst).toBe(0);
  });

  it("returns 'not_enough_data' when the owner has too few other published clips to compare against", () => {
    const result = generateClipNarrative(
      { topFactors: [factor()], breakdown: [contribution()] },
      { engagementScore: 0.5, ownerEngagementScores: [0.3, 0.2] },
    );

    expect(result.classification).toBe('not_enough_data');
    expect(result.comparedAgainst).toBe(2);
    expect(result.summary).toContain('2');
  });

  it("classifies 'over_performed' when the outcome is well above the owner's median", () => {
    const result = generateClipNarrative(
      { topFactors: [factor({ signal: 'audio', description: 'Loud audio' })], breakdown: [contribution()] },
      { engagementScore: 0.6, ownerEngagementScores: BASELINE_HISTORY },
    );

    expect(result.classification).toBe('over_performed');
    expect(result.comparedAgainst).toBe(5);
    expect(result.summary).toContain('audio');
    expect(result.summary).toContain('Loud audio');
  });

  it("classifies 'under_performed' when the outcome is well below the owner's median", () => {
    const result = generateClipNarrative(
      {
        topFactors: [factor()],
        breakdown: [contribution({ signal: 'facial', feature: 'smileRate', weight: 0.2, weightedContribution: 0.01 })],
      },
      { engagementScore: 0.1, ownerEngagementScores: BASELINE_HISTORY },
    );

    expect(result.classification).toBe('under_performed');
    expect(result.summary).toContain('facial');
  });

  it("classifies 'as_expected' when the outcome is within the band around the median", () => {
    const result = generateClipNarrative(
      { topFactors: [factor()], breakdown: [contribution()] },
      { engagementScore: 0.3, ownerEngagementScores: BASELINE_HISTORY },
    );

    expect(result.classification).toBe('as_expected');
  });

  it('excludes weight-0 (not-yet-calibrated) signals from lowSignals - a weight-0 signal being "low" is not a real finding', () => {
    const result = generateClipNarrative(
      {
        topFactors: [factor()],
        breakdown: [
          contribution({ signal: 'scene', weight: 0, weightedContribution: 0 }),
          contribution({ signal: 'gesture', weight: 0.1, weightedContribution: 0.05 }),
        ],
      },
      { engagementScore: 0.3, ownerEngagementScores: BASELINE_HISTORY },
    );

    expect(result.lowSignals.map((s) => s.signal)).toEqual(['gesture']);
  });

  it('sorts topSignals by absolute weightedContribution, defensively, not trusting input order', () => {
    const result = generateClipNarrative(
      {
        topFactors: [
          factor({ signal: 'small', weightedContribution: 0.05 }),
          factor({ signal: 'big', weightedContribution: -0.4 }),
        ],
        breakdown: [contribution()],
      },
      { engagementScore: 0.3, ownerEngagementScores: BASELINE_HISTORY },
    );

    expect(result.topSignals[0].signal).toBe('big');
  });

  it('caps topSignals/lowSignals at 3 entries each', () => {
    const manyFactors = Array.from({ length: 5 }, (_, i) =>
      factor({ signal: `signal-${i}`, weightedContribution: i / 10 }),
    );
    const manyContributions = Array.from({ length: 5 }, (_, i) =>
      contribution({ signal: `signal-${i}`, weight: 0.1, weightedContribution: i / 10 }),
    );

    const result = generateClipNarrative(
      { topFactors: manyFactors, breakdown: manyContributions },
      { engagementScore: 0.3, ownerEngagementScores: BASELINE_HISTORY },
    );

    expect(result.topSignals).toHaveLength(3);
    expect(result.lowSignals).toHaveLength(3);
  });
});
