import type { FusionPrediction } from '@speedora/contracts';

// Step 7: Prediction. A coarse, deterministic bucket derived from
// highlightScore + confidence - NOT a statistically calibrated forecast,
// same "heuristic, not a trained model" honesty as the rest of this
// engine. There is no engagement dataset behind these thresholds; they're
// a reasonable starting point pending real data (see weights.ts's Checkpoint
// 5 note - the same "needs validation later" caveat applies here).
const HIGH_SCORE_THRESHOLD = 65;
const LOW_SCORE_THRESHOLD = 35;
const MIN_TRUSTED_CONFIDENCE = 0.4;

export function predictPerformance(
  highlightScore: number | null,
  confidence: number,
): FusionPrediction {
  if (highlightScore === null) {
    return {
      bucket: 'uncertain',
      rationale: 'No signals were available to base a prediction on.',
    };
  }

  const confidencePercent = (confidence * 100).toFixed(0);

  if (confidence < MIN_TRUSTED_CONFIDENCE) {
    return {
      bucket: 'uncertain',
      rationale:
        `Score is ${highlightScore} but confidence is low (${confidencePercent}%) - too ` +
        'few signals were available to trust this prediction.',
    };
  }

  if (highlightScore >= HIGH_SCORE_THRESHOLD) {
    return {
      bucket: 'likely_high_performer',
      rationale: `Score of ${highlightScore} with ${confidencePercent}% confidence suggests strong potential.`,
    };
  }

  if (highlightScore <= LOW_SCORE_THRESHOLD) {
    return {
      bucket: 'likely_low_performer',
      rationale: `Score of ${highlightScore} with ${confidencePercent}% confidence suggests limited potential.`,
    };
  }

  return {
    bucket: 'uncertain',
    rationale: `Score of ${highlightScore} is in the middle range - not clearly strong or weak.`,
  };
}
