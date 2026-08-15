import type { QualityDimensionScores } from '@speedora/contracts';
import { composeQualityAssessment } from './compose-quality-assessment';

function dims(overrides: Partial<QualityDimensionScores>): QualityDimensionScores {
  const unavailable = { score: null, basis: 'unavailable' as const, notes: 'n/a' };
  return {
    editorialQuality: unavailable,
    narrativeQuality: unavailable,
    technicalQuality: unavailable,
    visualQuality: unavailable,
    audioQuality: unavailable,
    captionQuality: unavailable,
    ...overrides,
  };
}

describe('composeQualityAssessment', () => {
  it('returns compositeScore 0 and confidence 0 when every dimension is unavailable', () => {
    const result = composeQualityAssessment(dims({}));
    expect(result.compositeScore).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('averages measured-only dimensions with full weight and full confidence for their share', () => {
    const result = composeQualityAssessment(
      dims({
        editorialQuality: { score: 80, basis: 'measured', notes: '' },
        narrativeQuality: { score: 60, basis: 'measured', notes: '' },
      }),
    );
    expect(result.compositeScore).toBe(70);
    // 2 of 6 dimensions covered, both at full measured weight -> 2/6
    expect(result.confidence).toBeCloseTo(2 / 6);
  });

  it('weighs proxy dimensions at half trust relative to measured ones', () => {
    const result = composeQualityAssessment(
      dims({
        editorialQuality: { score: 100, basis: 'measured', notes: '' },
        visualQuality: { score: 0, basis: 'proxy', notes: '' },
      }),
    );
    // weighted average: (100*1 + 0*0.5) / (1 + 0.5) = 100/1.5 = 66.67
    expect(result.compositeScore).toBeCloseTo(66.67, 1);
    // confidence: (1 + 0.5) / 6
    expect(result.confidence).toBeCloseTo(1.5 / 6);
  });

  it('excludes unavailable dimensions from both compositeScore and confidence entirely', () => {
    const result = composeQualityAssessment(
      dims({
        editorialQuality: { score: 90, basis: 'measured', notes: '' },
        captionQuality: { score: null, basis: 'unavailable', notes: '' },
      }),
    );
    expect(result.compositeScore).toBe(90);
    expect(result.confidence).toBeCloseTo(1 / 6);
  });

  it('preserves the original dimensions object on the result', () => {
    const input = dims({ editorialQuality: { score: 55, basis: 'measured', notes: 'x' } });
    const result = composeQualityAssessment(input);
    expect(result.dimensions).toEqual(input);
  });
});
