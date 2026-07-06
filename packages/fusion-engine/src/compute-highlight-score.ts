import {
  fusionInputSchema,
  fusionOutputSchema,
  type FusionFactor,
  type FusionInput,
  type FusionOutput,
  type FusionWeights,
} from '@speedora/contracts';
import {
  extractFeatures,
  normalizeFeatures,
  weightFeatures,
  type WeightedFeature,
} from './feature-pipeline';
import { predictPerformance } from './predict';
import { buildRecommendation } from './recommend';
import { DEFAULT_FUSION_WEIGHTS } from './weights';

// Mini Fusion Engine v2 (Fase 31) - revised per explicit user architectural
// direction: (1) weighted, not averaged, per-signal scoring with an
// injectable weight table (see weights.ts) so it can be re-tuned/optimized
// later without touching this code; (2) confidence + structured
// explainability as first-class output; (3) feature-level fusion (see
// feature-pipeline.ts) - individual named features are extracted,
// normalized, and weighted, not one opaque score per module. Still a
// deterministic HEURISTIC, not a trained/calibrated model - same explicit
// "kejujuran skala" already applied to Fase 8's ClipScores and v1's
// Mini Fusion Engine: there is no engagement dataset behind these weights
// or normalization curves.
//
// Pure and synchronous - no `deps`, no external call, no DB access at all.

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

// Step 4: Scoring. Weighted average of every feature's normalized value,
// using only features that ended up with a non-zero weight (a signal with
// weight 0 in the table - e.g. gesture, see weights.ts - still gets
// extracted/normalized/reported in `contributions` but never moves this
// number). Null when literally nothing with a non-zero weight was
// available - not a fabricated 0/50.
function computeScore(weighted: WeightedFeature[]): number | null {
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  const weightedSum = weighted.reduce((sum, item) => sum + item.weightedContribution, 0);
  return Math.round(clamp((weightedSum / totalWeight) * 100, 0, 100));
}

// Step 5: Confidence. Two independent notions blended together:
// - "coverage": how much of the theoretically-scorable weight (the sum of
//   every signal's configured weight) actually had data for this clip.
// - "quality": the average of any explicit per-sample classifier
//   confidence features that WERE present (facial/gesture peakConfidence)
//   - defaults to 1 (full trust) when no such signal applies, since
//   audio/scene are deterministic measurements with no inherent classifier
//   uncertainty of their own.
// This is a heuristic proxy, not a statistically calibrated probability -
// same honesty as the rest of this module.
function computeConfidence(weighted: WeightedFeature[], weights: FusionWeights): number {
  const presentSignals = new Set(
    weighted.filter((item) => item.weight > 0).map((item) => item.signal),
  );
  const totalPossibleWeight = Object.values(weights).reduce(
    (sum, weight) => sum + (weight ?? 0),
    0,
  );
  const presentWeight = [...presentSignals].reduce(
    (sum, signal) => sum + (weights[signal] ?? 0),
    0,
  );
  const coverage = totalPossibleWeight > 0 ? presentWeight / totalPossibleWeight : 0;

  // weight > 0 filter matters here too - a peakConfidence feature from a
  // signal with zero configured weight (e.g. gesture currently, see
  // weights.ts) doesn't move the score, so it shouldn't move overall
  // confidence either.
  const confidenceFeatures = weighted.filter(
    (item) => item.feature === 'peakConfidence' && item.weight > 0,
  );
  const quality =
    confidenceFeatures.length === 0
      ? 1
      : confidenceFeatures.reduce((sum, item) => sum + item.normalizedValue, 0) /
        confidenceFeatures.length;

  return clamp(coverage * quality, 0, 1);
}

const TOP_FACTOR_COUNT = 3;

// Fase 32 - human-readable label per llm.* feature name (see clip-scoring's
// SCORE_DOMAINS for the engagement/knowledge/conversion grouping these
// domain-prefixed feature names carry).
const LLM_FEATURE_LABELS: Record<string, string> = {
  'engagement.hookStrength': 'hook strength',
  'engagement.curiosity': 'curiosity',
  'engagement.emotion': 'emotional intensity',
  'engagement.storytelling': 'storytelling',
  'knowledge.educationalValue': 'educational value',
  'knowledge.practicalValue': 'practical/actionable value',
  'knowledge.novelty': 'novelty',
  'knowledge.trustAuthority': 'authority/credibility',
  'conversion.ctaStrength': 'call-to-action strength',
};

function describeFeature(item: WeightedFeature): string {
  const intensity =
    item.normalizedValue >= 0.7 ? 'high' : item.normalizedValue >= 0.4 ? 'moderate' : 'low';
  switch (item.feature) {
    case 'averageRmsDb':
      return `${intensity} vocal energy (avg ${item.value.toFixed(1)} dB)`;
    case 'speakingRateStdDev':
      return `${intensity} pacing variability (stddev ${item.value.toFixed(2)} wps)`;
    case 'cutsPerMinute':
      return `${intensity} visual dynamism (${item.value.toFixed(1)} cuts/min)`;
    case 'dominantEmotionWeight':
      return `dominant facial expression was ${item.label}`;
    case 'dominantGestureWeight':
      return `dominant hand gesture was ${item.label}`;
    case 'peakConfidence':
      return `${intensity} ${item.signal} classification confidence (${(item.value * 100).toFixed(0)}%)`;
    case 'stability':
      return `${intensity} ${item.signal} stability`;
    default: {
      const llmLabel = LLM_FEATURE_LABELS[item.feature];
      return llmLabel
        ? `${intensity} ${llmLabel} (${item.value.toFixed(0)}/100)`
        : `${item.signal}.${item.feature}`;
    }
  }
}

// Step 6: Explainability. Sorted by magnitude of weighted contribution
// (not raw normalized value) - a feature with a large normalized value but
// a tiny weight shouldn't outrank one with a smaller normalized value but a
// much larger weight, since the latter actually moved the score more.
function buildExplainability(weighted: WeightedFeature[]): {
  topFactors: FusionFactor[];
  reason: string;
} {
  const scored = weighted.filter((item) => item.weight > 0);
  const sorted = [...scored].sort(
    (a, b) => Math.abs(b.weightedContribution) - Math.abs(a.weightedContribution),
  );
  const topFactors: FusionFactor[] = sorted.slice(0, TOP_FACTOR_COUNT).map((item) => ({
    signal: item.signal,
    feature: item.feature,
    weightedContribution: item.weightedContribution,
    description: describeFeature(item),
  }));

  const reason =
    topFactors.length === 0
      ? 'No signals were available to score this clip.'
      : `${capitalize(topFactors.map((factor) => factor.description).join('; '))}.`;

  return { topFactors, reason };
}

export function computeHighlightScore(
  input: FusionInput,
  weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
): FusionOutput {
  const parsed = fusionInputSchema.parse(input);

  const extracted = extractFeatures(parsed);
  const normalized = normalizeFeatures(extracted);
  const weighted = weightFeatures(normalized, weights);

  const highlightScore = computeScore(weighted);
  const confidence = computeConfidence(weighted, weights);
  const { topFactors, reason } = buildExplainability(weighted);

  const contributions = weighted.map((item) => ({
    signal: item.signal,
    feature: item.feature,
    rawValue: item.isCategoryDerived ? null : item.value,
    normalizedValue: item.normalizedValue,
    weight: item.weight,
    weightedContribution: item.weightedContribution,
  }));

  // Step 7/8: Prediction and Recommendation - both deterministic, derived
  // purely from the score/confidence/contributions already computed above,
  // same heuristic-not-model honesty as every earlier step.
  const prediction = predictPerformance(highlightScore, confidence);
  const recommendation = buildRecommendation(prediction, weighted);

  return fusionOutputSchema.parse({
    clipId: parsed.clipId,
    highlightScore,
    confidence,
    contributions,
    explainability: { topFactors },
    reason,
    prediction,
    recommendation,
  });
}
