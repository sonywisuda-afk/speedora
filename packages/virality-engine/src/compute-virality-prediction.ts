import type {
  ComputeViralityPredictionInput,
  EmotionalArcSample,
  HookPredictionOutput,
  MomentumSample,
  NarrativeGraph,
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

// -1..1 (Phase 1's own expectedRetentionLift range) -> 0..1.
function normalizeSigned(value: number): number {
  return clamp01((value + 1) / 2);
}

function hasNarrativeGraph(
  narrativeGraph: NarrativeGraph | null,
): narrativeGraph is NarrativeGraph {
  return narrativeGraph != null && !narrativeGraph.unsegmented;
}

// Reuses the same isPayoffSegmentType/`resolves`-relation logic Phase 7's
// own payoffPresence used - resolution/takeaway/cta segments, or an
// explicit `resolves` relation, both read as "this narrative pays off."
function hasPayoff(narrativeGraph: NarrativeGraph): boolean {
  return (
    narrativeGraph.relations.some((relation) => relation.type === 'resolves') ||
    narrativeGraph.segments.some((segment) => isPayoffSegmentType(segment.type))
  );
}

// A conflict/escalation segment with no `resolves` relation reads as
// "unresolved tension" - the kind of open loop that invites comments
// (agreement/disagreement/questions), distinct from hasPayoff() above.
function hasUnresolvedTension(narrativeGraph: NarrativeGraph): boolean {
  const hasTensionSegment = narrativeGraph.segments.some(
    (segment) => segment.type === 'conflict' || segment.type === 'escalation',
  );
  const hasResolution = narrativeGraph.relations.some((relation) => relation.type === 'resolves');
  return hasTensionSegment && !hasResolution;
}

function hasTakeaway(narrativeGraph: NarrativeGraph): boolean {
  return narrativeGraph.segments.some((segment) => segment.type === 'takeaway');
}

// Average momentumScore over the final third of the curve - a clip whose
// momentum collapses right before the end predicts viewers bail before
// completion. Null (not 0) when there are too few samples to isolate a
// meaningful final third.
function computeLateMomentum(momentumCurve: MomentumSample[]): number | null {
  if (momentumCurve.length < 3) return null;
  const startIndex = Math.floor((momentumCurve.length * 2) / 3);
  const lateSamples = momentumCurve.slice(startIndex);
  return average(lateSamples.map((sample) => sample.momentumScore));
}

// Human-readable labels for the reason string below - a plain Record, not
// an exhaustive switch, since these are fixed object keys established
// alongside the type itself (ViralitySubProbabilities), not a governed
// domain enum a future phase might extend independently.
const SUB_PROBABILITY_LABELS: Record<keyof ViralitySubProbabilities, string> = {
  scrollStopProbability: 'scroll-stop likelihood',
  watchProbability: 'sustained watch likelihood',
  completionProbability: 'completion likelihood',
  shareProbability: 'share likelihood',
  commentProbability: 'comment likelihood',
  saveProbability: 'save likelihood',
  followProbability: 'follow likelihood',
};

function buildReason(
  subProbabilities: ViralitySubProbabilities,
  overallViralScore: number | null,
  confidencePercent: string,
): string {
  const entries = Object.entries(subProbabilities) as Array<
    [keyof ViralitySubProbabilities, number | null]
  >;
  const present = entries.filter(
    (entry): entry is [keyof ViralitySubProbabilities, number] => entry[1] !== null,
  );
  if (present.length === 0 || overallViralScore === null) {
    return 'Not enough signals were available to estimate virality potential.';
  }
  const [strongestKey] = present.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const [weakestKey] = present.reduce((worst, entry) => (entry[1] < worst[1] ? entry : worst));
  const scorePercent = Math.round(overallViralScore * 100);
  const strongestLabel = SUB_PROBABILITY_LABELS[strongestKey];
  const weakestLabel = SUB_PROBABILITY_LABELS[weakestKey];
  return strongestKey === weakestKey
    ? `Overall viral score is estimated at ${scorePercent}% (${confidencePercent}% confidence) - based on ${strongestLabel}.`
    : `Overall viral score is estimated at ${scorePercent}% (${confidencePercent}% confidence) - strongest signal: ${strongestLabel}; weakest: ${weakestLabel}.`;
}

function computeScrollStopProbability(hookPrediction: HookPredictionOutput | null): number | null {
  return hookPrediction ? hookPrediction.predictionFeatures.expectedScrollStopRate : null;
}

function computeWatchProbability(
  hookPrediction: HookPredictionOutput | null,
  narrativeGraph: NarrativeGraph | null,
  momentumCurve: MomentumSample[],
): number | null {
  const parts: number[] = [];
  if (momentumCurve.length > 0) {
    parts.push(average(momentumCurve.map((sample) => sample.momentumScore)));
  }
  if (hookPrediction) {
    parts.push(normalizeSigned(hookPrediction.predictionFeatures.expectedRetentionLift));
  }
  if (hasNarrativeGraph(narrativeGraph)) {
    parts.push(new Set(narrativeGraph.segments.map((segment) => segment.type)).size / 10);
  }
  return parts.length === 0 ? null : average(parts);
}

function computeCompletionProbability(
  narrativeGraph: NarrativeGraph | null,
  momentumCurve: MomentumSample[],
): number | null {
  const parts: number[] = [];
  if (hasNarrativeGraph(narrativeGraph)) {
    parts.push(hasPayoff(narrativeGraph) ? 1 : 0);
  }
  const lateMomentum = computeLateMomentum(momentumCurve);
  if (lateMomentum !== null) {
    parts.push(lateMomentum);
  }
  return parts.length === 0 ? null : average(parts);
}

function computeShareProbability(
  hookPrediction: HookPredictionOutput | null,
  emotionalArc: EmotionalArcSample[],
): number | null {
  const parts: number[] = [];
  if (hookPrediction) {
    parts.push(
      average([
        hookPrediction.linguisticFeatures.surpriseScore,
        hookPrediction.linguisticFeatures.controversyScore,
      ]),
    );
  }
  if (emotionalArc.length > 0) {
    parts.push(Math.max(...emotionalArc.map((sample) => sample.intensity)));
  }
  return parts.length === 0 ? null : average(parts);
}

function computeCommentProbability(
  hookPrediction: HookPredictionOutput | null,
  narrativeGraph: NarrativeGraph | null,
): number | null {
  const parts: number[] = [];
  if (hookPrediction) {
    parts.push(
      average([
        hookPrediction.linguisticFeatures.controversyScore,
        hookPrediction.linguisticFeatures.questionDensity,
      ]),
    );
  }
  if (hasNarrativeGraph(narrativeGraph)) {
    parts.push(hasUnresolvedTension(narrativeGraph) ? 1 : 0);
  }
  return parts.length === 0 ? null : average(parts);
}

// namedEntities/numericFactCount have no fixed upper bound, so this caps at
// a small heuristic ceiling (5) rather than an unbounded normalization -
// same "clamp a heuristic ratio into 0-1" reasoning as every other derived
// signal in this module.
const SAVE_SIGNAL_CEILING = 5;

function computeSaveProbability(
  hookPrediction: HookPredictionOutput | null,
  narrativeGraph: NarrativeGraph | null,
): number | null {
  const parts: number[] = [];
  if (hookPrediction) {
    const factScore = clamp01(
      hookPrediction.linguisticFeatures.numericFactCount / SAVE_SIGNAL_CEILING,
    );
    const entityScore = clamp01(
      hookPrediction.linguisticFeatures.namedEntities.length / SAVE_SIGNAL_CEILING,
    );
    parts.push(average([factScore, entityScore]));
  }
  if (hasNarrativeGraph(narrativeGraph)) {
    parts.push(hasTakeaway(narrativeGraph) ? 1 : 0);
  }
  return parts.length === 0 ? null : average(parts);
}

// The WEAKEST-SUPPORTED probability of the 7 (see the contract's own doc
// comment) - no speaker-trust signal is one of this phase's 4 dependencies,
// so this only proxies parasocial "will they follow" via emotional warmth,
// not any real trust/authority/engagement measure.
const POSITIVE_HOOK_EMOTIONS = new Set(['hap', 'happy', 'positive', 'joy']);

function computeFollowProbability(
  hookPrediction: HookPredictionOutput | null,
  emotionalArc: EmotionalArcSample[],
): number | null {
  const parts: number[] = [];
  if (hookPrediction) {
    const dominant = hookPrediction.linguisticFeatures.dominantEmotion.toLowerCase();
    parts.push(POSITIVE_HOOK_EMOTIONS.has(dominant) ? 1 : 0);
  }
  const classified = emotionalArc.filter((sample) => sample.emotion !== null);
  if (classified.length > 0) {
    const happyCount = classified.filter((sample) => sample.emotion === 'hap').length;
    parts.push(happyCount / classified.length);
  }
  return parts.length === 0 ? null : average(parts);
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter at all, same
// zero-LLM shape as Phase 4/5/6. "Cross-module Fusion": fuses Phases
// 1/3/4/5's already-computed outputs into the spec's own 7 named
// probabilities (Phase 9's realignment of Phase 7 - see this module's
// contract doc comment and ADR D12). Never re-derives any of the 4 inputs
// itself, never calls an LLM.
export function computeViralityPrediction(
  input: ComputeViralityPredictionInput,
): ViralityPrediction {
  const { hookPrediction, narrativeGraph, momentumCurve, emotionalArc } = input;

  const subProbabilities: ViralitySubProbabilities = {
    scrollStopProbability: computeScrollStopProbability(hookPrediction),
    watchProbability: computeWatchProbability(hookPrediction, narrativeGraph, momentumCurve),
    completionProbability: computeCompletionProbability(narrativeGraph, momentumCurve),
    shareProbability: computeShareProbability(hookPrediction, emotionalArc),
    commentProbability: computeCommentProbability(hookPrediction, narrativeGraph),
    saveProbability: computeSaveProbability(hookPrediction, narrativeGraph),
    followProbability: computeFollowProbability(hookPrediction, emotionalArc),
  };

  const nonNullValues = Object.values(subProbabilities).filter(
    (value): value is number => value !== null,
  );
  const overallViralScore = nonNullValues.length === 0 ? null : average(nonNullValues);
  const confidence = nonNullValues.length / 7;
  const confidencePercent = (confidence * 100).toFixed(0);

  return {
    clipId: input.clipId,
    overallViralScore,
    confidence,
    reason: buildReason(subProbabilities, overallViralScore, confidencePercent),
    subProbabilities,
  };
}
