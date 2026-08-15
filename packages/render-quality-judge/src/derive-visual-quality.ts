import type { QualityDimensionScore } from '@speedora/contracts';
import { VISUAL_INSTABILITY_PROXY_PENALTY } from './weights';

export interface DeriveVisualQualityInput {
  // EditorialDecision.categories.visualEngagement (render mode) - null when EditorialDecision was
  // never computed. Deliberately NOT what its name suggests for THIS purpose: it's the average
  // editingSuggestions[].score for this clip, i.e. how much the Visual Emphasis Engine decided to
  // act on it, not a measurement of the picture's own quality (framing/exposure/sharpness/
  // composition) - see this dimension's own 'proxy' basis and notes below.
  visualEngagement: number | null;
  // EditorialDecision.negativeSignals contains a triggered (penalty > 0) 'visualInstability'
  // signal - reused directly, not re-detected.
  hasVisualInstabilitySignal: boolean;
}

// No real visual-quality detector (sharpness/exposure/composition on actual rendered pixels)
// exists anywhere in this codebase - confirmed by the Phase C1 audit. This is an honest,
// explicitly-labeled PROXY built from the closest available signals, not a substitute.
export function deriveVisualQuality(input: DeriveVisualQualityInput): QualityDimensionScore {
  if (input.visualEngagement == null) {
    return {
      score: null,
      basis: 'unavailable',
      notes:
        'No visualEngagement signal available (render-mode EditorialDecision was never computed) ' +
        'and no other visual-quality proxy exists.',
    };
  }

  const score = Math.max(
    0,
    input.visualEngagement -
      (input.hasVisualInstabilitySignal ? VISUAL_INSTABILITY_PROXY_PENALTY : 0),
  );

  return {
    score,
    basis: 'proxy',
    notes:
      'PROXY ONLY - derived from visualEngagement (how much the Visual Emphasis Engine acted on ' +
      'this clip) and a visualInstability penalty flag, NEITHER of which measures actual picture ' +
      'quality. No real visual-quality detector exists yet - see docs/ai/render-quality-judge.md.',
  };
}
