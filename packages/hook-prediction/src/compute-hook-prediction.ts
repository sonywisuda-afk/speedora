import type {
  HookLinguisticFeatures,
  HookPredictionInput,
  HookPredictionOutput,
} from '@speedora/contracts';

// Pure scoring step (ADR D2 - a stateless module never touches I/O; the one
// LLM call lives in extract-linguistic-features.ts, not here). Combines
// already-computed signals (ADR D5) into one hookProbability with an
// explainability reason, the same "weighted contribution + topFactors"
// shape as the Fusion Engine's own compute-highlight-score.ts - deliberately
// reused rather than inventing a different explainability convention.
//
// EVERY weight below is a documented HEURISTIC, not a calibrated/trained
// value - "scale honesty" (docs/coding-standards.md). Same collection-
// first-calibrate-later posture as Fusion Engine v2's own weights.ts: this
// formula is the module's honest first attempt, not a claim of accuracy.

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

// Same calibration-pending thresholds as Fusion Engine v2's own
// averageRmsDb normalizer (packages/fusion-engine/src/feature-pipeline.ts) -
// reused here rather than inventing a second, inconsistent dB scale for the
// same underlying signal.
const AUDIO_QUIET_DB = -40;
const AUDIO_LOUD_DB = -10;

// A heuristic "engaging pace" range - most natural spoken delivery falls
// within this band; well outside it (very slow or very rushed) is scored as
// less hook-effective. Not derived from any real engagement data.
const SPEAKING_RATE_LOW_WPS = 1.0;
const SPEAKING_RATE_HIGH_WPS = 4.0;

// A numeric fact beyond this count stops adding hook value - a clip that's
// wall-to-wall statistics doesn't hook harder than one with a handful of
// well-placed ones.
const NUMERIC_FACT_SATURATION_COUNT = 5;

interface WeightedContribution {
  feature: string;
  value: number; // 0-1, already normalized
  weight: number;
}

// Sums to 1.0. Grouped to match the ADR D5 input table: linguistic (the one
// new LLM-derived signal) carries the largest share since it's the only
// dimension built specifically to answer "does this hook," audio/speaker/
// pause are reused signals with a smaller, supporting role.
const WEIGHTS = {
  surpriseScore: 0.15,
  controversyScore: 0.1,
  keywordRarityScore: 0.1,
  topicShiftScore: 0.05,
  questionDensity: 0.15,
  numericFactDensity: 0.05,
  audioEnergy: 0.15,
  speakingPace: 0.05,
  speakerConfidence: 0.1,
  pauseBeforeHook: 0.1,
} as const;

const DESCRIPTIONS: Record<keyof typeof WEIGHTS, string> = {
  surpriseScore: 'a surprising, unexpected opening',
  controversyScore: 'a controversial/debate-provoking topic',
  keywordRarityScore: 'unusual, specific vocabulary',
  topicShiftScore: 'an abrupt topic shift',
  questionDensity: 'a question posed directly to the viewer',
  numericFactDensity: 'concrete numbers/statistics stated up front',
  audioEnergy: 'high vocal energy',
  speakingPace: 'an engaging speaking pace',
  speakerConfidence: 'a confident, steady speaker',
  pauseBeforeHook: 'a deliberate pause before the hook lands',
};

function buildReason(top: WeightedContribution[]): string {
  if (top.length === 0) {
    return 'Not enough signal to explain this prediction - most inputs were unavailable.';
  }
  const phrases = top.map((c) => DESCRIPTIONS[c.feature as keyof typeof WEIGHTS]);
  return `Hook potential driven mainly by ${phrases.join(' and ')}.`;
}

export function computeHookPrediction(
  input: HookPredictionInput,
  linguisticFeatures: HookLinguisticFeatures,
): HookPredictionOutput {
  const contributions: WeightedContribution[] = [
    { feature: 'surpriseScore', value: linguisticFeatures.surpriseScore, weight: WEIGHTS.surpriseScore },
    {
      feature: 'controversyScore',
      value: linguisticFeatures.controversyScore,
      weight: WEIGHTS.controversyScore,
    },
    {
      feature: 'keywordRarityScore',
      value: linguisticFeatures.keywordRarityScore,
      weight: WEIGHTS.keywordRarityScore,
    },
    {
      feature: 'topicShiftScore',
      value: linguisticFeatures.topicShiftScore,
      weight: WEIGHTS.topicShiftScore,
    },
    {
      feature: 'questionDensity',
      value: linguisticFeatures.questionDensity,
      weight: WEIGHTS.questionDensity,
    },
    {
      feature: 'numericFactDensity',
      value: clamp01(
        mapRange(
          Math.min(linguisticFeatures.numericFactCount, NUMERIC_FACT_SATURATION_COUNT),
          0,
          NUMERIC_FACT_SATURATION_COUNT,
          0,
          1,
        ),
      ),
      weight: WEIGHTS.numericFactDensity,
    },
    { feature: 'pauseBeforeHook', value: input.pauseFeatures.pauseBeforeHookRatio, weight: WEIGHTS.pauseBeforeHook },
  ];

  if (input.audioFeatures.averageRmsDb !== null) {
    contributions.push({
      feature: 'audioEnergy',
      value: clamp01(mapRange(input.audioFeatures.averageRmsDb, AUDIO_QUIET_DB, AUDIO_LOUD_DB, 0, 1)),
      weight: WEIGHTS.audioEnergy,
    });
  }
  if (input.audioFeatures.averageSpeakingRateWordsPerSecond !== null) {
    const wps = input.audioFeatures.averageSpeakingRateWordsPerSecond;
    // Peaks in the middle of the range, falls off toward either edge -
    // "engaging pace" is a band, not a monotonic "faster is better."
    const midpoint = (SPEAKING_RATE_LOW_WPS + SPEAKING_RATE_HIGH_WPS) / 2;
    const halfRange = (SPEAKING_RATE_HIGH_WPS - SPEAKING_RATE_LOW_WPS) / 2;
    const distance = Math.abs(wps - midpoint) / halfRange;
    contributions.push({
      feature: 'speakingPace',
      value: clamp01(1 - distance),
      weight: WEIGHTS.speakingPace,
    });
  }
  if (input.dominantSpeakerConfidence !== null) {
    contributions.push({
      feature: 'speakerConfidence',
      value: input.dominantSpeakerConfidence,
      weight: WEIGHTS.speakerConfidence,
    });
  }

  const coveredWeight = contributions.reduce((sum, c) => sum + c.weight, 0);
  const totalWeight = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
  const weightedSum = contributions.reduce((sum, c) => sum + c.value * c.weight, 0);

  const hookProbability =
    coveredWeight > 0 ? Math.round(clamp01(weightedSum / coveredWeight) * 100) : 0;
  // Coverage-only confidence (no per-feature quality signal exists yet for
  // this module, unlike the Fusion Engine's coverage x quality) - same
  // "fraction of configured weight actually backed by non-null data" idea.
  const confidence = totalWeight > 0 ? clamp01(coveredWeight / totalWeight) : 0;

  const topFactors = [...contributions]
    .sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))
    .slice(0, 3);

  // HEURISTIC prediction features (ADR D4) - direct, documented transforms
  // of hookProbability/linguisticFeatures, not independently modeled
  // quantities. None of these are calibrated against real engagement data.
  const expectedScrollStopRate = clamp01(hookProbability / 100);
  const expectedRetentionLift = Math.max(-1, Math.min(1, (hookProbability - 50) / 50));
  const expectedReplayPotential = clamp01(
    (linguisticFeatures.surpriseScore + linguisticFeatures.questionDensity) / 2,
  );

  return {
    clipId: input.clipId,
    hookProbability,
    reason: buildReason(topFactors),
    confidence,
    linguisticFeatures,
    predictionFeatures: {
      expectedScrollStopRate,
      expectedRetentionLift,
      expectedReplayPotential,
    },
  };
}
