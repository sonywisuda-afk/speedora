import {
  QUALITY_DIMENSIONS,
  type FinalClipQualityAssessment,
  type QualityDimensionBasis,
  type QualityDimensionScores,
} from '@speedora/contracts';
import { MEASURED_WEIGHT, PROXY_WEIGHT } from './weights';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function weightFor(basis: QualityDimensionBasis): number {
  if (basis === 'measured') return MEASURED_WEIGHT;
  if (basis === 'proxy') return PROXY_WEIGHT;
  return 0;
}

// Weighted average over every non-'unavailable' dimension (measured weight 1, proxy weight 0.5 -
// see weights.ts) - a proxy-basis dimension counts as real evidence, but at half the trust of a
// measured one, never treated as equivalent. `confidence` is coverage discounted the same way,
// not a separate computation - a clip covered entirely by proxies reads as meaningfully LESS
// certain than one covered by real measurements, not merely "some coverage exists" either way.
export function composeQualityAssessment(
  dimensions: QualityDimensionScores,
): FinalClipQualityAssessment {
  const entries = QUALITY_DIMENSIONS.map((dimension) => dimensions[dimension]);
  const weighable = entries.filter((entry) => entry.basis !== 'unavailable' && entry.score != null);

  const totalWeight = weighable.reduce((sum, entry) => sum + weightFor(entry.basis), 0);
  const compositeScore =
    totalWeight === 0
      ? 0
      : clamp(
          weighable.reduce((sum, entry) => sum + weightFor(entry.basis) * (entry.score ?? 0), 0) /
            totalWeight,
          0,
          100,
        );

  const confidence = clamp(totalWeight / QUALITY_DIMENSIONS.length, 0, 1);

  return {
    dimensions,
    compositeScore,
    confidence,
  };
}
