import type { QualityDimensionScore } from '@speedora/contracts';

export interface DeriveEditorialQualityInput {
  // EditorialDecision.editorialScore (render mode) - null only when EditorialDecision itself was
  // never computed (this clip's own ClipScores never persisted at candidate-creation time), same
  // "an optional signal genuinely unavailable never counts against a candidate" convention as
  // every other v4 signal's own null-handling.
  editorialScore: number | null;
}

// A real, already-computed editorial judgment (docs/ai/editorial-director.md) - the strongest,
// most directly-named signal this module reuses, hence 'measured' rather than 'proxy'.
export function deriveEditorialQuality(input: DeriveEditorialQualityInput): QualityDimensionScore {
  if (input.editorialScore == null) {
    return {
      score: null,
      basis: 'unavailable',
      notes:
        "Editorial Director's EditorialDecision was never computed for this clip (its own " +
        'ClipScores never persisted) - no fallback signal exists for editorial quality.',
    };
  }

  return {
    score: input.editorialScore,
    basis: 'measured',
    notes:
      "Editorial Director's own weighted editorialScore composite (docs/ai/editorial-director.md) " +
      '- a real, already-computed editorial judgment, reused directly.',
  };
}
