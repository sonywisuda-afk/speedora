import {
  THUMBNAIL_SIGNALS,
  type SelectThumbnailTimestampInput,
  type SelectThumbnailTimestampOutput,
  type ThumbnailContribution,
  type ThumbnailSignal,
  type ThumbnailWeights,
} from '@speedora/contracts';
import { scoreComposition } from './score-composition';
import { scoreEmotion } from './score-emotion';
import { scoreFaceClarity } from './score-face-clarity';
import { scoreGesture } from './score-gesture';
import { scoreMotion } from './score-motion';
import { scoreOcrImportance } from './score-ocr-importance';
import { DEFAULT_THUMBNAIL_WEIGHTS } from './weights';

function clipMidpoint(clipDurationSeconds: number): SelectThumbnailTimestampOutput {
  return {
    timestampSeconds: clipDurationSeconds / 2,
    confidence: 0,
    contributions: [],
    fallbackLevel: 'midpoint',
    reason: 'no timed signals available, falling back to clip midpoint',
  };
}

function buildContributions(
  scoreMaps: Record<ThumbnailSignal, Map<number, number>>,
  weights: ThumbnailWeights,
  timestampSeconds: number,
  signalsWithData: ThumbnailSignal[],
): ThumbnailContribution[] {
  return signalsWithData
    .map((signal): ThumbnailContribution => {
      const weight = weights[signal] ?? 0;
      const normalizedValue = scoreMaps[signal].get(timestampSeconds) ?? 0;
      return {
        signal,
        // Every score-*.ts function in this package already returns a
        // normalized [0,1] value directly (unlike fusion-engine, which
        // normalizes separately-tracked raw units) - there's no distinct
        // "raw measurement" to report here, same "categorical hit" null
        // convention as fusion-engine's ExtractedFeature.isCategoryDerived.
        rawValue: null,
        normalizedValue,
        weight,
        weightedContribution: weight * normalizedValue,
      };
    })
    .sort((a, b) => Math.abs(b.weightedContribution) - Math.abs(a.weightedContribution));
}

function buildReason(
  contributions: ThumbnailContribution[],
  fallbackLevel: 'single_signal' | 'multi_signal',
): string {
  if (contributions.length === 0) return 'no signal contributed at the selected timestamp';
  const top = contributions[0];
  if (fallbackLevel === 'single_signal') {
    return `only "${top.signal}" had timed data for this clip; chose its own best-scoring instant`;
  }
  const names = contributions.map((contribution) => contribution.signal).join(', ');
  return `chose the instant with the highest combined score across ${names}, led by "${top.signal}"`;
}

// Level 2 (frame/timestamp) selection - see @speedora/contracts'
// thumbnail-selection.ts for the full POLICY comment this module must never
// violate: highlightScore/highlightRank (Level 1, which CLIP) are never
// read here, only per-timestamp signals.
export function selectThumbnailTimestamp(
  input: SelectThumbnailTimestampInput,
  weights: ThumbnailWeights = DEFAULT_THUMBNAIL_WEIGHTS,
): SelectThumbnailTimestampOutput {
  // Candidates: union of every DISCRETE-SAMPLE signal's own `t` values
  // within the clip's bounds - not a fixed-interval resample, since every
  // signal here is already sampled at its own producer's cadence and
  // resampling would just interpolate fabricated values. OCR tracks are
  // time RANGES, not discrete samples, so they don't contribute their own
  // candidate timestamps (see scoreOcrImportance's own comment) - they're
  // evaluated against whichever candidates the other signals produced.
  const candidateTimestamps = Array.from(
    new Set([
      ...(input.faceLandmarks ?? []).map((sample) => sample.t),
      ...(input.facialEmotions ?? []).map((sample) => sample.t),
      ...(input.gestures ?? []).map((sample) => sample.t),
      ...(input.motionEnergy ?? []).map((sample) => sample.t),
      ...(input.primarySubjectSamples ?? []).map((sample) => sample.t),
    ]),
  )
    .filter((t) => t >= 0 && t <= input.clipDurationSeconds)
    .sort((a, b) => a - b);

  if (candidateTimestamps.length === 0) return clipMidpoint(input.clipDurationSeconds);

  const scoreMaps: Record<ThumbnailSignal, Map<number, number>> = {
    faceClarity: scoreFaceClarity(input.faceLandmarks),
    emotion: scoreEmotion(input.facialEmotions),
    ocrImportance: scoreOcrImportance(input.ocrTracks, candidateTimestamps),
    gesture: scoreGesture(input.gestures),
    motion: scoreMotion(input.motionEnergy, input.sceneCutEvents),
    composition: scoreComposition(input.primarySubjectSamples),
  };

  // Confidence: fraction of WEIGHTED signals with any usable data anywhere
  // in this clip - a coverage read, same spirit as FusionOutput.confidence.
  const weightedSignals = THUMBNAIL_SIGNALS.filter((signal) => (weights[signal] ?? 0) > 0);
  const signalsWithData = weightedSignals.filter((signal) => scoreMaps[signal].size > 0);
  const confidence =
    weightedSignals.length > 0 ? signalsWithData.length / weightedSignals.length : 0;

  if (signalsWithData.length === 0) return clipMidpoint(input.clipDurationSeconds);

  if (signalsWithData.length === 1) {
    const signal = signalsWithData[0];
    const map = scoreMaps[signal];
    let bestT = candidateTimestamps[0];
    let bestValue = -Infinity;
    for (const t of candidateTimestamps) {
      const value = map.get(t);
      if (value === undefined || value <= bestValue) continue;
      bestValue = value;
      bestT = t;
    }
    const contributions = buildContributions(scoreMaps, weights, bestT, [signal]);
    return {
      timestampSeconds: bestT,
      confidence,
      contributions,
      fallbackLevel: 'single_signal',
      reason: buildReason(contributions, 'single_signal'),
    };
  }

  // Multi-signal: score(t) = sum of weight[signal] * scoreMap[signal](t)
  // over whichever signals have data - same "weighted average over
  // whichever features exist" shape as computeHighlightScore, except
  // evaluated per-candidate-timestamp here. Ties broken by earliest `t`
  // (strict `>` below, candidates iterated in ascending order).
  let bestT = candidateTimestamps[0];
  let bestScore = -Infinity;
  for (const t of candidateTimestamps) {
    let score = 0;
    for (const signal of signalsWithData) {
      const weight = weights[signal] ?? 0;
      score += weight * (scoreMaps[signal].get(t) ?? 0);
    }
    if (score <= bestScore) continue;
    bestScore = score;
    bestT = t;
  }

  const contributions = buildContributions(scoreMaps, weights, bestT, signalsWithData);
  return {
    timestampSeconds: bestT,
    confidence,
    contributions,
    fallbackLevel: 'multi_signal',
    reason: buildReason(contributions, 'multi_signal'),
  };
}
