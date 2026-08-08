import type {
  ComputeRetentionCurveInsightsInput,
  EmotionalArcSample,
  MomentumSample,
  RetentionCurveInsights,
  RetentionPoint,
} from '@speedora/contracts';
import { findPeakIndices, findTroughIndices, meanAndStddev } from '@speedora/scene-intelligence';
import { isCuriositySemanticEventType } from './is-curiosity-semantic-event-type';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Local minima in MomentumCurve.momentumScore - a sustained/sharp momentum
// drop reads as a likely audience-drop-off moment. `score` is the drop's
// own severity (how far below neutral the trough sits), not a coverage or
// confidence figure.
function findDropPoints(momentumCurve: MomentumSample[]): RetentionPoint[] {
  if (momentumCurve.length === 0) return [];
  const values = momentumCurve.map((sample) => sample.momentumScore);
  const { mean, stddev } = meanAndStddev(values);
  const troughIndices = findTroughIndices(values, mean, stddev);
  return troughIndices.map((index) => ({
    t: momentumCurve[index].t,
    score: clamp01(1 - momentumCurve[index].momentumScore),
  }));
}

// Nearest sample by |t - targetT|, ties broken by whichever comes first -
// same "temporal nearest neighbor" shape @speedora/multimodal-reasoning's
// findConcurrentEvidence() already uses for a different signal pair.
function findNearestByTime<T extends { t: number }>(samples: T[], targetT: number): T | null {
  if (samples.length === 0) return null;
  return samples.reduce((nearest, sample) =>
    Math.abs(sample.t - targetT) < Math.abs(nearest.t - targetT) ? sample : nearest,
  );
}

// Local maxima in MomentumCurve.momentumScore - a likely rewatch-worthy
// moment, boosted by the temporally-nearest EmotionalArc sample's
// intensity when one exists (a peak that's also emotionally charged is a
// stronger replay signal than momentum alone).
function findReplayZones(
  momentumCurve: MomentumSample[],
  emotionalArc: EmotionalArcSample[],
): RetentionPoint[] {
  if (momentumCurve.length === 0) return [];
  const values = momentumCurve.map((sample) => sample.momentumScore);
  const { mean, stddev } = meanAndStddev(values);
  const peakIndices = findPeakIndices(values, mean, stddev);
  return peakIndices.map((index) => {
    const sample = momentumCurve[index];
    const nearestEmotion = findNearestByTime(emotionalArc, sample.t);
    const score = nearestEmotion
      ? clamp01(average([sample.momentumScore, nearestEmotion.intensity]))
      : sample.momentumScore;
    return { t: sample.t, score };
  });
}

// Local maxima in EmotionalArc.intensity.
function findEmotionalPeaks(emotionalArc: EmotionalArcSample[]): RetentionPoint[] {
  if (emotionalArc.length === 0) return [];
  const values = emotionalArc.map((sample) => sample.intensity);
  const { mean, stddev } = meanAndStddev(values);
  const peakIndices = findPeakIndices(values, mean, stddev);
  return peakIndices.map((index) => ({
    t: emotionalArc[index].t,
    score: emotionalArc[index].intensity,
  }));
}

// SemanticEvent[] entries whose type reads as curiosity-evoking - t/score
// come directly from the event's own t/importance, no re-derivation.
function findCuriosityPeaks(
  semanticEvents: ComputeRetentionCurveInsightsInput['semanticEvents'],
): RetentionPoint[] {
  if (!semanticEvents) return [];
  return semanticEvents
    .filter((event) => isCuriositySemanticEventType(event.type))
    .map((event) => ({ t: event.t, score: event.importance }));
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter, same zero-LLM
// shape as Phase 4/5/6/9. A new ADDITIVE layer over Phases 4/5's own
// already-computed outputs (ADR D13) - never re-derives MomentumCurve/
// EmotionalArc/SemanticEvent[] itself, never calls an LLM.
export function computeRetentionCurveInsights(
  input: ComputeRetentionCurveInsightsInput,
): RetentionCurveInsights {
  const { clipId, momentumCurve, emotionalArc, semanticEvents } = input;

  return {
    clipId,
    dropPoints: findDropPoints(momentumCurve),
    replayZones: findReplayZones(momentumCurve, emotionalArc),
    emotionalPeaks: findEmotionalPeaks(emotionalArc),
    curiosityPeaks: findCuriosityPeaks(semanticEvents),
  };
}
