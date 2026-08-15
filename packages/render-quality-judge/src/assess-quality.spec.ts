import type { EditorialCategoryScores } from '@speedora/contracts';
import { assessClipQuality } from './assess-quality';

const categories: EditorialCategoryScores = {
  contentValue: 70,
  hookStrength: 70,
  narrativeCompleteness: 80,
  contextCompleteness: 75,
  emotionalPayoff: 65,
  visualEngagement: 55,
  speakerClarity: 60,
  platformFit: 70,
};

const technical = {
  renderVerificationPassed: true,
  hasVideoStream: true,
  hasAudioStream: true,
  requestedDurationSeconds: 45,
  renderedDurationSeconds: 45,
};

describe('assessClipQuality', () => {
  it('composes all 6 dimensions into one validated FinalClipQualityAssessment', () => {
    const result = assessClipQuality({
      editorialScore: 78,
      categories,
      hasVisualInstabilitySignal: false,
      technical,
    });

    expect(result.dimensions.editorialQuality).toEqual({
      score: 78,
      basis: 'measured',
      notes: expect.any(String),
    });
    expect(result.dimensions.narrativeQuality.basis).toBe('measured');
    expect(result.dimensions.technicalQuality).toEqual({
      score: 100,
      basis: 'measured',
      notes: expect.any(String),
    });
    expect(result.dimensions.visualQuality).toEqual({
      score: 55,
      basis: 'proxy',
      notes: expect.any(String),
    });
    expect(result.dimensions.audioQuality).toEqual({
      score: 60,
      basis: 'proxy',
      notes: expect.any(String),
    });
    expect(result.dimensions.captionQuality).toEqual({
      score: null,
      basis: 'unavailable',
      notes: expect.any(String),
    });
    expect(result.compositeScore).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1);
  });

  it('degrades gracefully to an all-unavailable-but-technical result when EditorialDecision is null', () => {
    const result = assessClipQuality({
      editorialScore: null,
      categories: null,
      hasVisualInstabilitySignal: false,
      technical,
    });

    expect(result.dimensions.editorialQuality.basis).toBe('unavailable');
    expect(result.dimensions.narrativeQuality.basis).toBe('unavailable');
    expect(result.dimensions.visualQuality.basis).toBe('unavailable');
    expect(result.dimensions.audioQuality.basis).toBe('unavailable');
    expect(result.dimensions.captionQuality.basis).toBe('unavailable');
    expect(result.dimensions.technicalQuality.basis).toBe('measured');
    expect(result.compositeScore).toBe(100);
    // only technicalQuality (measured, weight 1) of 6 dimensions covered
    expect(result.confidence).toBeCloseTo(1 / 6);
  });
});
