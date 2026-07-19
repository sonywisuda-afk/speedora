import type { ClipPredictionSection } from '@speedora/shared';
import { MIN_SAMPLES_FOR_CORRELATION, pearsonCorrelation } from '@speedora/dataset-quality';

// Sprint 6J (Predicted performance) - a heuristic statistical projection,
// explicitly NOT a new trained model. Reuses packages/dataset-quality's
// exact pearsonCorrelation/MIN_SAMPLES_FOR_CORRELATION - the same function
// /ops/ai/correlation already uses system-wide - called here per-owner
// instead of pooled globally. Fusion Engine v3's real ML pipeline
// (packages/fusion-ml) is paused pending real production data and
// completely untouched by this.

export interface PredictionPair {
  highlightScore: number;
  engagementScore: number;
}

// Simple least-squares slope/intercept - deliberately not the ML pipeline's
// gradient-descent trainer (packages/fusion-ml's BaselineLinearModelTrainer,
// a separate, paused initiative). This is a closed-form fit over a handful
// of numbers, not a model with its own lifecycle/versioning/registry.
function linearRegression(pairs: PredictionPair[]): { slope: number; intercept: number } {
  const n = pairs.length;
  const meanX = pairs.reduce((sum, p) => sum + p.highlightScore, 0) / n;
  const meanY = pairs.reduce((sum, p) => sum + p.engagementScore, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (const p of pairs) {
    const dx = p.highlightScore - meanX;
    numerator += dx * (p.engagementScore - meanY);
    denominator += dx * dx;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

// history is this clip's owner's OTHER published clips' real
// (highlightScore, engagementScore) pairs - never this clip's own. Degrades
// gracefully the same way ops-ai.service.ts's getCorrelation/getCalibration
// already do: `available: false` with a real sampleCount/minSamplesRequired
// whenever there isn't enough data or no meaningful correlation exists,
// never a fabricated prediction.
export function predictEngagement(
  highlightScore: number | null,
  history: PredictionPair[],
): ClipPredictionSection {
  const base = {
    sampleCount: history.length,
    minSamplesRequired: MIN_SAMPLES_FOR_CORRELATION,
  };

  if (highlightScore === null) {
    return {
      ...base,
      available: false,
      reason: 'This clip has no highlightScore yet.',
      correlation: null,
      predictedEngagementScore: null,
    };
  }

  if (history.length < MIN_SAMPLES_FOR_CORRELATION) {
    return {
      ...base,
      available: false,
      reason: `Not enough of this creator's other published clips yet (${history.length}/${MIN_SAMPLES_FOR_CORRELATION}) to predict performance.`,
      correlation: null,
      predictedEngagementScore: null,
    };
  }

  const correlation = pearsonCorrelation(
    history.map((h) => h.highlightScore),
    history.map((h) => h.engagementScore),
  );
  if (correlation === null) {
    return {
      ...base,
      available: false,
      reason: "No meaningful correlation between highlightScore and this creator's real engagement yet.",
      correlation: null,
      predictedEngagementScore: null,
    };
  }

  const { slope, intercept } = linearRegression(history);
  // engagementScore is a non-negative ratio in this app - clamped
  // defensively, same posture as lib/explainability.ts's toPercent clamp,
  // against a small/negative-history fit projecting below zero.
  const predictedEngagementScore = Math.max(0, slope * highlightScore + intercept);

  return { ...base, available: true, correlation, predictedEngagementScore };
}
