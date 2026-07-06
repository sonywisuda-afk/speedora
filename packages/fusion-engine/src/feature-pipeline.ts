import type {
  AudioFeatures,
  ClipScores,
  FacialEmotionFeatures,
  FusionInput,
  FusionSignal,
  FusionWeights,
  GestureFeatures,
  SceneFeatures,
} from '@speedora/contracts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

// Step 1: Feature Extraction. Turns each signal's Features object into a
// flat list of NAMED values - deliberately several per signal where
// meaningful (e.g. audio's loudness AND pacing variability, facial's
// dominant expression AND classifier confidence AND stability), not one
// pre-collapsed score per module. This is the "feature-level fusion, not
// just per-module scores" requirement: nothing about a signal's shape is
// lost here, it's just flattened into a common list shape the rest of the
// pipeline can treat uniformly regardless of which module produced it.
export interface ExtractedFeature {
  signal: FusionSignal;
  feature: string;
  value: number;
  // true for a value that's already a derived category weight (e.g. an
  // emotion/gesture mapped to a 0-100 "attention-grabbing" score) rather
  // than a raw sensor measurement - carried through so the final output's
  // `rawValue` can honestly report null for these instead of a
  // number that looks like a real measurement but isn't one.
  isCategoryDerived: boolean;
  // Only set for category-derived features - the original label (e.g.
  // "happy", "thumb_up") that produced this value, used by explainability
  // to describe the feature in human terms.
  label?: string;
}

// High-arousal emotions (happy/surprise/angry/fear) weighted above low-
// arousal ones (neutral/sad) - a "attention-grabbing expression" proxy, not
// a claim about sentiment/positivity. Mirrors the v1 Mini Fusion Engine's
// table (Fase 29).
const EMOTION_WEIGHT: Record<string, number> = {
  happy: 90,
  surprise: 90,
  angry: 75,
  fear: 70,
  disgust: 60,
  sad: 55,
  neutral: 40,
};
const DEFAULT_EMOTION_WEIGHT = 50;

// Same "attention-grabbing, not sentiment" proxy as EMOTION_WEIGHT, for
// MediaPipe's 7-gesture taxonomy plus "none" (a hand detected but no
// recognized gesture - still some signal that a hand is in frame, hence a
// non-zero baseline rather than 0).
const GESTURE_WEIGHT: Record<string, number> = {
  thumb_up: 90,
  victory: 90,
  i_love_you: 90,
  thumb_down: 70,
  pointing_up: 60,
  open_palm: 55,
  closed_fist: 50,
  none: 30,
};
const DEFAULT_GESTURE_WEIGHT = 50;

function extractAudioFeatures(features: AudioFeatures | undefined): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.averageRmsDb !== null) {
    items.push({
      signal: 'audio',
      feature: 'averageRmsDb',
      value: features.averageRmsDb,
      isCategoryDerived: false,
    });
  }
  if (features.speakingRateStdDev !== null) {
    items.push({
      signal: 'audio',
      feature: 'speakingRateStdDev',
      value: features.speakingRateStdDev,
      isCategoryDerived: false,
    });
  }
  return items;
}

function extractSceneFeatures(features: SceneFeatures | undefined): ExtractedFeature[] {
  if (!features || features.cutsPerMinute === null) return [];
  return [
    {
      signal: 'scene',
      feature: 'cutsPerMinute',
      value: features.cutsPerMinute,
      isCategoryDerived: false,
    },
  ];
}

function extractFacialFeatures(features: FacialEmotionFeatures | undefined): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.dominantEmotion !== null) {
    items.push({
      signal: 'facial',
      feature: 'dominantEmotionWeight',
      value: EMOTION_WEIGHT[features.dominantEmotion] ?? DEFAULT_EMOTION_WEIGHT,
      isCategoryDerived: true,
      label: features.dominantEmotion,
    });
  }
  if (features.peakConfidence !== null) {
    items.push({
      signal: 'facial',
      feature: 'peakConfidence',
      value: features.peakConfidence,
      isCategoryDerived: false,
    });
  }
  if (features.stability !== null) {
    items.push({
      signal: 'facial',
      feature: 'stability',
      value: features.stability,
      isCategoryDerived: false,
    });
  }
  return items;
}

function extractGestureFeatures(features: GestureFeatures | undefined): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.dominantGesture !== null) {
    items.push({
      signal: 'gesture',
      feature: 'dominantGestureWeight',
      value: GESTURE_WEIGHT[features.dominantGesture] ?? DEFAULT_GESTURE_WEIGHT,
      isCategoryDerived: true,
      label: features.dominantGesture,
    });
  }
  if (features.peakConfidence !== null) {
    items.push({
      signal: 'gesture',
      feature: 'peakConfidence',
      value: features.peakConfidence,
      isCategoryDerived: false,
    });
  }
  if (features.stability !== null) {
    items.push({
      signal: 'gesture',
      feature: 'stability',
      value: features.stability,
      isCategoryDerived: false,
    });
  }
  return items;
}

// Fase 32 - clip-scoring's ClipScores is already a per-clip "Features"-
// shaped object (unlike audio/scene/facial/gesture, there's no raw
// per-sample timeline to reduce - the LLM call itself produces one
// 0-100 value per named dimension directly), so extraction here is a
// straight 1:1 mapping, not a derivation. Every one of the 9 dimensions
// becomes its own named feature - "feature-level fusion" applies here too,
// not one collapsed "llm score". Domain-prefixed feature names
// (engagement./knowledge./conversion. - see clip-scoring's SCORE_DOMAINS)
// keep the grouping the user asked for visible in `contributions`/
// explainability, even though weighting itself still treats every llm
// feature the same for now (the whole `llm` signal weight split evenly
// across whichever of these 9 are present) - domain-level sub-weights are
// an intentionally-deferred next step, not an oversight, should a real
// need for them show up.
function extractLlmFeatures(scores: ClipScores | undefined): ExtractedFeature[] {
  if (!scores) return [];
  return [
    {
      signal: 'llm',
      feature: 'engagement.hookStrength',
      value: scores.hookStrength,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'engagement.curiosity',
      value: scores.curiosity,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'engagement.emotion',
      value: scores.emotion,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'engagement.storytelling',
      value: scores.storytelling,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'knowledge.educationalValue',
      value: scores.educationalValue,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'knowledge.practicalValue',
      value: scores.practicalValue,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'knowledge.novelty',
      value: scores.novelty,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'knowledge.trustAuthority',
      value: scores.trustAuthority,
      isCategoryDerived: false,
    },
    {
      signal: 'llm',
      feature: 'conversion.ctaStrength',
      value: scores.ctaStrength,
      isCategoryDerived: false,
    },
  ];
}

export function extractFeatures(input: FusionInput): ExtractedFeature[] {
  return [
    ...extractAudioFeatures(input.audio),
    ...extractSceneFeatures(input.scene),
    ...extractFacialFeatures(input.facial),
    ...extractGestureFeatures(input.gesture),
    ...extractLlmFeatures(input.llm),
  ];
}

// Step 2: Feature Normalization. Every extracted feature, whatever its
// native unit (dB, cuts/minute, an already-0-1 confidence, a 0-100 category
// weight), gets mapped to a common [0, 1] scale via a registry keyed by
// feature name - so the weighting/scoring steps never need to know a
// feature's original unit.
export interface NormalizedFeature extends ExtractedFeature {
  normalizedValue: number;
}

// Absolute dB thresholds (not relative to the rest of the same video) and
// the 0-20 cuts/minute cap are the same simplifications flagged in v1
// (Fase 29) - carried forward, not re-litigated here.
const AUDIO_QUIET_DB = -40;
const AUDIO_LOUD_DB = -10;
const SPEAKING_RATE_STD_DEV_CAP = 2;
const SCENE_CUTS_PER_MINUTE_CAP = 20;
const SCENE_BASELINE = 0.2;

// clip-scoring's LLM output is already 0-100 by contract (clampScores()
// there), so every llm.* normalizer is the same plain /100 divide - listed
// individually (rather than a wildcard match) so an unrecognized feature
// name still throws instead of silently normalizing.
const LLM_SCORE_NORMALIZER = (value: number) => clamp(value / 100, 0, 1);

const NORMALIZERS: Record<string, (value: number) => number> = {
  averageRmsDb: (value) => clamp(mapRange(value, AUDIO_QUIET_DB, AUDIO_LOUD_DB, 0, 1), 0, 1),
  speakingRateStdDev: (value) => clamp(mapRange(value, 0, SPEAKING_RATE_STD_DEV_CAP, 0, 1), 0, 1),
  cutsPerMinute: (value) =>
    clamp(mapRange(value, 0, SCENE_CUTS_PER_MINUTE_CAP, SCENE_BASELINE, 1), 0, 1),
  dominantEmotionWeight: (value) => clamp(value / 100, 0, 1),
  dominantGestureWeight: (value) => clamp(value / 100, 0, 1),
  // Already 0-1 by contract (facial/gesture peakConfidence/stability).
  peakConfidence: (value) => clamp(value, 0, 1),
  stability: (value) => clamp(value, 0, 1),
  'engagement.hookStrength': LLM_SCORE_NORMALIZER,
  'engagement.curiosity': LLM_SCORE_NORMALIZER,
  'engagement.emotion': LLM_SCORE_NORMALIZER,
  'engagement.storytelling': LLM_SCORE_NORMALIZER,
  'knowledge.educationalValue': LLM_SCORE_NORMALIZER,
  'knowledge.practicalValue': LLM_SCORE_NORMALIZER,
  'knowledge.novelty': LLM_SCORE_NORMALIZER,
  'knowledge.trustAuthority': LLM_SCORE_NORMALIZER,
  'conversion.ctaStrength': LLM_SCORE_NORMALIZER,
};

export function normalizeFeatures(extracted: ExtractedFeature[]): NormalizedFeature[] {
  return extracted.map((item) => {
    const normalizer = NORMALIZERS[item.feature];
    if (!normalizer) {
      throw new Error(`No normalizer registered for feature "${item.feature}"`);
    }
    return { ...item, normalizedValue: normalizer(item.value) };
  });
}

// Step 3: Feature Weighting. A signal's configured weight (see weights.ts)
// is split evenly across however many of ITS OWN features are actually
// present, so a signal's total influence on the score matches its
// configured weight regardless of how many individual features happen to
// be available for a given clip.
export interface WeightedFeature extends NormalizedFeature {
  weight: number;
  weightedContribution: number;
}

export function weightFeatures(
  normalized: NormalizedFeature[],
  weights: FusionWeights,
): WeightedFeature[] {
  const featureCountBySignal = new Map<FusionSignal, number>();
  for (const item of normalized) {
    featureCountBySignal.set(item.signal, (featureCountBySignal.get(item.signal) ?? 0) + 1);
  }

  return normalized.map((item) => {
    const signalWeight = weights[item.signal] ?? 0;
    const featureCount = featureCountBySignal.get(item.signal) ?? 1;
    const weight = signalWeight / featureCount;
    return { ...item, weight, weightedContribution: weight * item.normalizedValue };
  });
}
