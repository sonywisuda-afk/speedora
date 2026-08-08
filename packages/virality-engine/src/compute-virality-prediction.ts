import type {
  ComputeViralityPredictionInput,
  MomentumSample,
  ViralityPrediction,
  ViralitySubProbabilities,
} from '@speedora/contracts';
import { isPayoffSegmentType } from './is-payoff-segment-type';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Null (not 0) when there are fewer than 2 samples to compare a first-half
// vs second-half trend against - "not enough data," not "no build."
// HEURISTIC (ADR D4): a simple index-based split, not time-weighted.
function computeBuildIntensity(momentumCurve: MomentumSample[]): number | null {
  if (momentumCurve.length < 2) return null;
  const midpoint = Math.floor(momentumCurve.length / 2);
  const firstHalf = momentumCurve.slice(0, midpoint);
  const secondHalf = momentumCurve.slice(midpoint);
  const firstAverage = average(firstHalf.map((sample) => sample.momentumScore));
  const secondAverage = average(secondHalf.map((sample) => sample.momentumScore));
  return clamp01((secondAverage - firstAverage + 1) / 2);
}

// Human-readable labels for the reason string below - a plain Record, not
// an exhaustive switch, since these are fixed object keys established
// alongside the type itself (ViralitySubProbabilities), not a governed
// domain enum a future phase might extend independently.
const SUB_PROBABILITY_LABELS: Record<keyof ViralitySubProbabilities, string> = {
  hookStrength: 'hook strength',
  replayPotential: 'replay potential',
  buildIntensity: 'momentum build',
  peakMomentum: 'peak momentum',
  emotionalIntensity: 'emotional intensity',
  emotionalRange: 'emotional range',
  narrativeCompleteness: 'narrative completeness',
  payoffPresence: 'payoff presence',
};

function buildReason(
  subProbabilities: ViralitySubProbabilities,
  viralityProbability: number | null,
  confidencePercent: string,
): string {
  const entries = Object.entries(subProbabilities) as Array<
    [keyof ViralitySubProbabilities, number | null]
  >;
  const present = entries.filter(
    (entry): entry is [keyof ViralitySubProbabilities, number] => entry[1] !== null,
  );
  if (present.length === 0 || viralityProbability === null) {
    return 'Not enough signals were available to estimate virality potential.';
  }
  const [strongestKey] = present.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const [weakestKey] = present.reduce((worst, entry) => (entry[1] < worst[1] ? entry : worst));
  const probabilityPercent = Math.round(viralityProbability * 100);
  const strongestLabel = SUB_PROBABILITY_LABELS[strongestKey];
  const weakestLabel = SUB_PROBABILITY_LABELS[weakestKey];
  return strongestKey === weakestKey
    ? `Virality potential is estimated at ${probabilityPercent}% (${confidencePercent}% confidence) - based on ${strongestLabel}.`
    : `Virality potential is estimated at ${probabilityPercent}% (${confidencePercent}% confidence) - strongest signal: ${strongestLabel}; weakest: ${weakestLabel}.`;
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter at all, same
// zero-LLM shape as Phase 4/5/6. "Cross-module Fusion": fuses Phases
// 1/3/4/5's already-computed outputs, 2 sub-probabilities sourced from
// each, into one composite estimate. Never re-derives any of the 4 inputs
// itself, never calls an LLM.
export function computeViralityPrediction(
  input: ComputeViralityPredictionInput,
): ViralityPrediction {
  const { hookPrediction, narrativeGraph, momentumCurve, emotionalArc } = input;

  const hookStrength = hookPrediction ? hookPrediction.hookProbability / 100 : null;
  const replayPotential = hookPrediction
    ? hookPrediction.predictionFeatures.expectedReplayPotential
    : null;

  const buildIntensity = computeBuildIntensity(momentumCurve);
  const peakMomentum =
    momentumCurve.length === 0
      ? null
      : Math.max(...momentumCurve.map((sample) => sample.momentumScore));

  const intensities = emotionalArc.map((sample) => sample.intensity);
  const emotionalIntensity = emotionalArc.length === 0 ? null : average(intensities);
  const emotionalRange =
    emotionalArc.length === 0 ? null : Math.max(...intensities) - Math.min(...intensities);

  const hasNarrativeGraph = narrativeGraph != null && !narrativeGraph.unsegmented;
  const narrativeCompleteness = hasNarrativeGraph
    ? new Set(narrativeGraph.segments.map((segment) => segment.type)).size / 10
    : null;
  const payoffPresence = hasNarrativeGraph
    ? narrativeGraph.relations.some((relation) => relation.type === 'resolves')
      ? 1
      : narrativeGraph.segments.some((segment) => isPayoffSegmentType(segment.type))
        ? 0.5
        : 0
    : null;

  const subProbabilities: ViralitySubProbabilities = {
    hookStrength,
    replayPotential,
    buildIntensity,
    peakMomentum,
    emotionalIntensity,
    emotionalRange,
    narrativeCompleteness,
    payoffPresence,
  };

  const nonNullValues = Object.values(subProbabilities).filter(
    (value): value is number => value !== null,
  );
  const viralityProbability = nonNullValues.length === 0 ? null : average(nonNullValues);
  const confidence = nonNullValues.length / 8;
  const confidencePercent = (confidence * 100).toFixed(0);

  return {
    clipId: input.clipId,
    viralityProbability,
    confidence,
    reason: buildReason(subProbabilities, viralityProbability, confidencePercent),
    subProbabilities,
  };
}
