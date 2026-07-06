import { buildRecommendation } from './recommend';

describe('buildRecommendation', () => {
  it('recommends publishing as-is for a likely_high_performer', () => {
    const result = buildRecommendation({ bucket: 'likely_high_performer', rationale: 'x' }, []);
    expect(result.action).toBe('publish_as_is');
  });

  it('recommends manual review for an uncertain prediction', () => {
    const result = buildRecommendation({ bucket: 'uncertain', rationale: 'x' }, []);
    expect(result.action).toBe('review_manually');
  });

  it('targets the single weakest weighted feature for a likely_low_performer', () => {
    const result = buildRecommendation({ bucket: 'likely_low_performer', rationale: 'x' }, [
      {
        signal: 'audio',
        feature: 'averageRmsDb',
        value: -35,
        isCategoryDerived: false,
        normalizedValue: 0.1,
        weight: 0.35,
        weightedContribution: 0.035,
      },
      {
        signal: 'scene',
        feature: 'cutsPerMinute',
        value: 15,
        isCategoryDerived: false,
        normalizedValue: 0.8,
        weight: 0.3,
        weightedContribution: 0.24,
      },
    ]);
    // averageRmsDb (0.1) is weaker than cutsPerMinute (0.8) - should target audio.
    expect(result.action).toBe('boost_audio_energy');
  });

  it('falls back to manual review when no weighted features are available at all', () => {
    const result = buildRecommendation({ bucket: 'likely_low_performer', rationale: 'x' }, [
      {
        signal: 'gesture',
        feature: 'peakConfidence',
        value: 0.9,
        isCategoryDerived: false,
        normalizedValue: 0.9,
        weight: 0,
        weightedContribution: 0,
      },
    ]);
    expect(result.action).toBe('review_manually');
  });
});
