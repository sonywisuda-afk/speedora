import type { FeatureDriftResult, MissingDataEntry } from '@speedora/dataset-quality';

// Milestone 5C-B - the two pieces of AI Operations Dashboard logic not
// already covered by @speedora/dataset-quality (missing data/distribution/
// drift/calibration) or @speedora/analytics-report's fusion-signal-analytics
// aggregation (signal contributions/explainability reasons). Pure, no Prisma
// access, same module/adapter split as every other util in this codebase.

// Heuristic, unvalidated thresholds - same "scale honesty" caveat as every
// other threshold in this codebase's calibration tooling.
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;

export interface AiHealthInput {
  highlightScore: number | null;
  highlightConfidence: number | null;
  hasExplainability: boolean;
}

export interface AiHealthResult {
  totalClipsWithScore: number;
  averageConfidence: number | null;
  lowConfidenceThreshold: number;
  highConfidenceThreshold: number;
  lowConfidenceClips: number;
  highConfidenceClips: number;
  missingExplainability: number;
}

export function computeAiHealth(clips: AiHealthInput[]): AiHealthResult {
  const withScore = clips.filter((c) => c.highlightScore !== null);
  const confidences = withScore
    .map((c) => c.highlightConfidence)
    .filter((v): v is number => v !== null);

  return {
    totalClipsWithScore: withScore.length,
    averageConfidence:
      confidences.length === 0
        ? null
        : confidences.reduce((sum, v) => sum + v, 0) / confidences.length,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
    highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
    lowConfidenceClips: confidences.filter((c) => c < LOW_CONFIDENCE_THRESHOLD).length,
    highConfidenceClips: confidences.filter((c) => c >= HIGH_CONFIDENCE_THRESHOLD).length,
    missingExplainability: withScore.filter((c) => !c.hasExplainability).length,
  };
}

// New in Milestone 5C-B: a forward-looking verdict for "is there enough
// data to start M2C (Baseline ML Training)?". MIN_SAMPLES_FOR_TRAINING is a
// heuristic placeholder, deliberately higher than
// @speedora/dataset-quality's MIN_SAMPLES_FOR_CORRELATION (20) - a
// correlation read and an actual training run don't need the same sample
// floor - and explicitly unvalidated pending real ML training experience,
// same "heuristic, not proven" honesty as DRIFT_THRESHOLD_PCT and every
// other threshold in this tooling.
export const MIN_SAMPLES_FOR_TRAINING = 200;

export interface ReadinessResult {
  ready: boolean;
  usableSamples: number;
  minSamplesRequired: number;
  blockers: string[];
}

export function computeReadinessVerdict(params: {
  usableSamples: number;
  drift: FeatureDriftResult;
  featureCompleteness: MissingDataEntry[];
}): ReadinessResult {
  const blockers: string[] = [];

  if (params.usableSamples < MIN_SAMPLES_FOR_TRAINING) {
    blockers.push(
      `Only ${params.usableSamples} usable sample(s) with engagement data - below the ${MIN_SAMPLES_FOR_TRAINING}-sample floor for training.`,
    );
  }
  // `in` narrowing, not the `insufficientData` literal-discriminant kind -
  // apps/api's tsconfig has strictNullChecks: false, under which
  // boolean-literal discriminated-union narrowing doesn't reliably narrow;
  // `in` checks property existence directly and isn't affected by that.
  const drift = params.drift;
  if ('entries' in drift) {
    const drifted = drift.entries.filter((e) => e.drifted);
    if (drifted.length > 0) {
      blockers.push(
        `${drifted.length} feature(s) show significant drift (${drifted
          .slice(0, 3)
          .map((e) => e.feature)
          .join(', ')}${drifted.length > 3 ? ', ...' : ''}) - resolve before training on them.`,
      );
    }
  }
  const highMissing = params.featureCompleteness.filter((f) => f.missingRatePct > 80);
  if (highMissing.length > 0) {
    blockers.push(`${highMissing.length} feature(s) are missing in >80% of clips.`);
  }

  return {
    ready: blockers.length === 0,
    usableSamples: params.usableSamples,
    minSamplesRequired: MIN_SAMPLES_FOR_TRAINING,
    blockers,
  };
}
