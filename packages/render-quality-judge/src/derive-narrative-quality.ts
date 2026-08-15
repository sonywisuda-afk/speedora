import type { EditorialCategoryScores, QualityDimensionScore } from '@speedora/contracts';

export interface DeriveNarrativeQualityInput {
  // EditorialDecision.categories (render mode) - null only when EditorialDecision itself was
  // never computed (see derive-editorial-quality.ts's own comment).
  categories: EditorialCategoryScores | null;
}

// Average of narrativeCompleteness/contextCompleteness/emotionalPayoff - Narrative Graph-derived
// structural completeness, reused directly. 'measured' (not 'proxy') - these categories are
// already named and computed for exactly this purpose (see docs/ai/editorial-director.md), not
// borrowed from an adjacent concept.
export function deriveNarrativeQuality(input: DeriveNarrativeQualityInput): QualityDimensionScore {
  if (input.categories == null) {
    return {
      score: null,
      basis: 'unavailable',
      notes:
        'EditorialDecision.categories was never computed for this clip - no fallback signal ' +
        'exists for narrative quality.',
    };
  }

  const values = [
    input.categories.narrativeCompleteness,
    input.categories.contextCompleteness,
    input.categories.emotionalPayoff,
  ];
  const score = values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    score,
    basis: 'measured',
    notes:
      'Average of EditorialDecision.categories.narrativeCompleteness/contextCompleteness/' +
      'emotionalPayoff - Narrative Graph-derived structural completeness, reused directly.',
  };
}
