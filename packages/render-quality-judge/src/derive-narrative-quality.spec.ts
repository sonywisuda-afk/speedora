import type { EditorialCategoryScores } from '@speedora/contracts';
import { deriveNarrativeQuality } from './derive-narrative-quality';

const baseCategories: EditorialCategoryScores = {
  contentValue: 50,
  hookStrength: 50,
  narrativeCompleteness: 90,
  contextCompleteness: 80,
  emotionalPayoff: 70,
  visualEngagement: 50,
  speakerClarity: 50,
  platformFit: 50,
};

describe('deriveNarrativeQuality', () => {
  it('averages narrativeCompleteness/contextCompleteness/emotionalPayoff as a measured dimension', () => {
    const result = deriveNarrativeQuality({ categories: baseCategories });
    expect(result.basis).toBe('measured');
    expect(result.score).toBeCloseTo((90 + 80 + 70) / 3);
  });

  it('returns unavailable when categories is null', () => {
    const result = deriveNarrativeQuality({ categories: null });
    expect(result.score).toBeNull();
    expect(result.basis).toBe('unavailable');
  });
});
