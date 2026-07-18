import type { FusionBreakdown, FusionExplainability } from '@speedora/shared';
import {
  computeExplainabilityReasonFrequency,
  computeScoreDistribution,
  computeSignalContributions,
} from './fusion-signal-analytics.util';

describe('computeScoreDistribution', () => {
  it('buckets scores into 10 fixed-width ranges over [0, 100]', () => {
    const result = computeScoreDistribution([5, 15, 50, 95]);
    expect(result[0]).toEqual({ bucket: '0-10', count: 1 });
    expect(result[1]).toEqual({ bucket: '10-20', count: 1 });
    expect(result[5]).toEqual({ bucket: '50-60', count: 1 });
    expect(result[9]).toEqual({ bucket: '90-100', count: 1 });
  });

  it('puts a score of exactly 100 in the last bucket, not overflowing', () => {
    const result = computeScoreDistribution([100]);
    expect(result[9].count).toBe(1);
  });

  it('returns all-zero buckets for an empty input', () => {
    const result = computeScoreDistribution([]);
    expect(result.every((b) => b.count === 0)).toBe(true);
    expect(result).toHaveLength(10);
  });
});

describe('computeSignalContributions', () => {
  function contribution(signal: string, weightedContribution: number): FusionBreakdown[number] {
    return {
      signal: signal as never,
      feature: 'f',
      rawValue: null,
      normalizedValue: 0.5,
      weight: 1,
      weightedContribution,
    };
  }

  it('normalizes each signal share of the total weightedContribution mass to a percent', () => {
    const breakdowns: FusionBreakdown[] = [
      [contribution('audio', 30), contribution('scene', 20)],
      [contribution('audio', 40), contribution('scene', 10)],
    ];

    const result = computeSignalContributions(breakdowns);

    const audio = result.find((r) => r.signal === 'audio')!;
    const scene = result.find((r) => r.signal === 'scene')!;
    expect(audio.averageContributionPct).toBeCloseTo(70);
    expect(scene.averageContributionPct).toBeCloseTo(30);
    expect(audio.clipsWithSignal).toBe(2);
    expect(scene.clipsWithSignal).toBe(2);
  });

  it('reads ~0% for a weight-0 signal that still shows up (extracted but not weighted)', () => {
    const breakdowns: FusionBreakdown[] = [
      [contribution('audio', 100), contribution('gesture', 0)],
    ];

    const result = computeSignalContributions(breakdowns);

    const gesture = result.find((r) => r.signal === 'gesture')!;
    expect(gesture.averageContributionPct).toBe(0);
    expect(gesture.clipsWithSignal).toBe(1);
  });

  it('returns an empty array when there are no breakdowns at all', () => {
    expect(computeSignalContributions([])).toEqual([]);
  });

  it('returns 0% for every signal when total weighted mass is 0', () => {
    const breakdowns: FusionBreakdown[] = [[contribution('audio', 0), contribution('scene', 0)]];
    const result = computeSignalContributions(breakdowns);
    expect(result.every((r) => r.averageContributionPct === 0)).toBe(true);
  });
});

describe('computeExplainabilityReasonFrequency', () => {
  function explainability(descriptions: string[]): FusionExplainability {
    return {
      topFactors: descriptions.map((description) => ({
        signal: 'audio' as never,
        feature: 'f',
        weightedContribution: 1,
        description,
      })),
    };
  }

  it('counts description frequency across clips and normalizes to a percent', () => {
    const result = computeExplainabilityReasonFrequency([
      explainability(['High Emotion', 'Rapid Speech']),
      explainability(['High Emotion']),
    ]);

    expect(result[0]).toEqual({ description: 'High Emotion', count: 2, pct: expect.closeTo(66.7) });
    expect(result[1]).toEqual({ description: 'Rapid Speech', count: 1, pct: expect.closeTo(33.3) });
  });

  it('returns an empty array when there are no explainability entries', () => {
    expect(computeExplainabilityReasonFrequency([])).toEqual([]);
  });
});
