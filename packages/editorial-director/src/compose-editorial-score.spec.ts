import type { ClipScores, EditorialCategoryScores } from '@speedora/contracts';
import {
  composeEditorialScore,
  computeCategoryConfidence,
  deriveEditorialCategories,
} from './compose-editorial-score';
import { RENDER_CATEGORY_WEIGHTS, SHORTLIST_CATEGORY_WEIGHTS } from './weights';

const SCORES: ClipScores = {
  hookStrength: 70,
  educationalValue: 60,
  practicalValue: 55,
  curiosity: 65,
  emotion: 50,
  storytelling: 60,
  novelty: 55,
  trustAuthority: 60,
  ctaStrength: 40,
};

function categories(overrides: Partial<EditorialCategoryScores> = {}): EditorialCategoryScores {
  return {
    contentValue: 60,
    hookStrength: 60,
    narrativeCompleteness: 60,
    contextCompleteness: 60,
    emotionalPayoff: 60,
    visualEngagement: null,
    speakerClarity: null,
    platformFit: 60,
    ...overrides,
  };
}

describe('deriveEditorialCategories', () => {
  it('leaves visualEngagement/speakerClarity null in shortlist mode', () => {
    const result = deriveEditorialCategories({
      mode: 'shortlist',
      scores: SCORES,
      narrativeGraph: null,
    });
    expect(result.visualEngagement).toBeNull();
    expect(result.speakerClarity).toBeNull();
  });

  it('populates visualEngagement with a neutral baseline in render mode with no suggestions', () => {
    const result = deriveEditorialCategories({
      mode: 'render',
      scores: SCORES,
      narrativeGraph: null,
      editingSuggestionScores: [],
    });
    expect(result.visualEngagement).toBe(50);
  });

  it('populates speakerClarity from the provided score in render mode', () => {
    const result = deriveEditorialCategories({
      mode: 'render',
      scores: SCORES,
      narrativeGraph: null,
      speakerClarityScore: 80,
    });
    expect(result.speakerClarity).toBe(80);
  });

  it('clamps every category into [0, 100]', () => {
    const result = deriveEditorialCategories({
      mode: 'render',
      scores: { ...SCORES, emotion: 500 },
      narrativeGraph: null,
      emotionalArcPeakIntensity: 2,
    });
    expect(result.emotionalPayoff).toBeLessThanOrEqual(100);
  });
});

describe('composeEditorialScore', () => {
  it('renormalizes over non-null categories', () => {
    const shortlistScore = composeEditorialScore(categories(), [], SHORTLIST_CATEGORY_WEIGHTS);
    expect(shortlistScore).toBeCloseTo(60, 0);
  });

  it('folds in visualEngagement/speakerClarity when present (render mode)', () => {
    const renderScore = composeEditorialScore(
      categories({ visualEngagement: 90, speakerClarity: 90 }),
      [],
      RENDER_CATEGORY_WEIGHTS,
    );
    expect(renderScore).toBeGreaterThan(60);
  });

  it('deducts capped negative signal penalties', () => {
    const base = composeEditorialScore(categories(), [], SHORTLIST_CATEGORY_WEIGHTS);
    const penalized = composeEditorialScore(
      categories(),
      [{ type: 'contextDependency', penalty: 24, reason: 'test' }],
      SHORTLIST_CATEGORY_WEIGHTS,
    );
    expect(penalized).toBeCloseTo(base - 24, 0);
  });

  it('caps total penalty deduction at MAX_TOTAL_PENALTY even when signals stack', () => {
    const base = composeEditorialScore(categories(), [], SHORTLIST_CATEGORY_WEIGHTS);
    const stacked = composeEditorialScore(
      categories(),
      [
        { type: 'contextDependency', penalty: 24, reason: 'a' },
        { type: 'redundancy', penalty: 20, reason: 'b' },
        { type: 'deadAir', penalty: 15, reason: 'c' },
      ],
      SHORTLIST_CATEGORY_WEIGHTS,
    );
    expect(stacked).toBeCloseTo(base - 40, 0);
  });

  it('never goes below 0', () => {
    const result = composeEditorialScore(
      categories({
        contentValue: 0,
        hookStrength: 0,
        narrativeCompleteness: 0,
        contextCompleteness: 0,
        emotionalPayoff: 0,
        platformFit: 0,
      }),
      [{ type: 'contextDependency', penalty: 24, reason: 'test' }],
      SHORTLIST_CATEGORY_WEIGHTS,
    );
    expect(result).toBe(0);
  });
});

describe('computeCategoryConfidence', () => {
  it('is 1 when every category is non-null', () => {
    expect(
      computeCategoryConfidence(categories({ visualEngagement: 80, speakerClarity: 80 })),
    ).toBe(1);
  });

  it('is less than 1 when some categories are null', () => {
    expect(computeCategoryConfidence(categories())).toBeLessThan(1);
  });
});
