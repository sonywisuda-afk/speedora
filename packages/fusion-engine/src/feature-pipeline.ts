import type {
  AudioFeatures,
  CameraMotionFeatures,
  ClipScores,
  EditingRhythmFeatures,
  FaceLandmarkFeatures,
  FacialEmotionFeatures,
  FusionInput,
  FusionSignal,
  FusionWeights,
  GestureFeatures,
  MotionEnergyFeatures,
  ObjectFeatures,
  OcrFeatures,
  SceneFeatures,
  SpeakerFusionFeatures,
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

// Same "attention-grabbing category weight" proxy as EMOTION_WEIGHT/
// GESTURE_WEIGHT below, for Batch 2's dominantLookingDirection - 'center'
// (looking at camera) scores highest, any deviation scores equally lower
// (this heuristic doesn't distinguish "slightly off" from "looking away
// entirely" at the category level - only the per-sample eyeContactRate
// feature captures degree/frequency).
const LOOKING_DIRECTION_WEIGHT: Record<string, number> = {
  center: 90,
  left: 50,
  right: 50,
  up: 50,
  down: 50,
};
const DEFAULT_LOOKING_DIRECTION_WEIGHT = 50;

// Batch 5D (Emotion Heuristic) - same "attention-grabbing category weight"
// proxy as EMOTION_WEIGHT/GESTURE_WEIGHT/LOOKING_DIRECTION_WEIGHT above,
// for the SAFE dominantAffect vocabulary (see @speedora/contracts'
// AFFECT_LABELS) - positive_affect/high_energy read as high-arousal/
// engaging, expressive as moderately so, low_energy/neutral as low-arousal
// - same "not a sentiment claim" caveat as EMOTION_WEIGHT.
const AFFECT_WEIGHT: Record<string, number> = {
  positive_affect: 90,
  high_energy: 90,
  expressive: 75,
  low_energy: 40,
  neutral: 40,
};
const DEFAULT_AFFECT_WEIGHT = 50;

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

// Batch SC-2 (Scene Intelligence taxonomy expansion) - motion-energy/
// static-dynamic classification, a SEPARATE signal from extractSceneFeatures
// above (see @speedora/contracts' FUSION_SIGNALS comment on why). Every
// field is a plain measurement (no category-derived weight table here,
// unlike facial/gesture's dominant-label mapping).
function extractMotionEnergyFeatures(
  features: MotionEnergyFeatures | undefined,
): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.averageMotionEnergy !== null) {
    items.push({
      signal: 'sceneMotion',
      feature: 'averageMotionEnergy',
      value: features.averageMotionEnergy,
      isCategoryDerived: false,
    });
  }
  if (features.dynamicRatio !== null) {
    items.push({
      signal: 'sceneMotion',
      feature: 'dynamicRatio',
      // dynamicRatio (not staticRatio) is the one extracted - "more motion
      // = higher normalizedValue" keeps this consistent with every other
      // feature's "higher normalizedValue = more of the thing being
      // measured" convention (cutsPerMinute, averageMotionEnergy itself,
      // etc.), rather than needing a special inverted case like
      // occlusionRate. staticRatio is always derivable as 1 - dynamicRatio
      // for a caller that wants it, so nothing is lost by only reporting one.
      value: features.dynamicRatio,
      isCategoryDerived: false,
    });
  }
  // Batch SC-5 - peakCount/peakTimestamps aren't extracted individually
  // (peakCount is redundant with peakRatePerMinute once duration-normalized;
  // peakTimestamps is a list, not a scalar the fusion pipeline can score) -
  // only the normalized rate feeds scoring, same "one representative scalar
  // per concept" pattern as dynamicRatio above.
  if (features.peakRatePerMinute !== null) {
    items.push({
      signal: 'sceneMotion',
      feature: 'peakRatePerMinute',
      value: features.peakRatePerMinute,
      isCategoryDerived: false,
    });
  }
  // Batch SC-6 - Motion Complexity (motion-energy half). Companion to
  // cameraMotion's motionTypeDiversity - see motionEnergyFeaturesSchema's
  // own contract comment for why these stay two separate features.
  if (features.motionVariability !== null) {
    items.push({
      signal: 'sceneMotion',
      feature: 'motionVariability',
      value: features.motionVariability,
      isCategoryDerived: false,
    });
  }
  return items;
}

// Batch SC-3 (Scene Intelligence taxonomy expansion) - directional camera
// motion (pan/tilt/zoom/shake), a SEPARATE signal from sceneMotion above
// (undirected magnitude). Same "attention-grabbing category weight" proxy
// as EMOTION_WEIGHT/GESTURE_WEIGHT/AFFECT_WEIGHT for dominantMotionType -
// zoom/pan/tilt read as deliberate cinematic choices, weighted a bit above
// static; `shake`'s weight is deliberately neutral (50, same as the
// DEFAULT) - unlike the others, this codebase has NO calibrated view on
// whether shake reads as engaging (intentional handheld energy) or a
// production-value problem (unstable footage), so it isn't nudged either
// direction, same "direction unproven" honesty as speakerChangeCount/
// pauseCount elsewhere in this file.
const CAMERA_MOTION_WEIGHT: Record<string, number> = {
  zoom: 80,
  pan: 65,
  tilt: 65,
  shake: 50,
  static: 40,
};
const DEFAULT_CAMERA_MOTION_WEIGHT = 50;

function extractCameraMotionFeatures(
  features: CameraMotionFeatures | undefined,
): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.panScore !== null) {
    items.push({
      signal: 'cameraMotion',
      feature: 'panScore',
      value: features.panScore,
      isCategoryDerived: false,
    });
  }
  if (features.tiltScore !== null) {
    items.push({
      signal: 'cameraMotion',
      feature: 'tiltScore',
      value: features.tiltScore,
      isCategoryDerived: false,
    });
  }
  if (features.zoomScore !== null) {
    items.push({
      signal: 'cameraMotion',
      feature: 'zoomScore',
      value: features.zoomScore,
      isCategoryDerived: false,
    });
  }
  if (features.shakeScore !== null) {
    items.push({
      signal: 'cameraMotion',
      feature: 'shakeScore',
      value: features.shakeScore,
      isCategoryDerived: false,
    });
  }
  if (features.dominantMotionType !== null) {
    items.push({
      signal: 'cameraMotion',
      feature: 'dominantMotionTypeWeight',
      value: CAMERA_MOTION_WEIGHT[features.dominantMotionType] ?? DEFAULT_CAMERA_MOTION_WEIGHT,
      isCategoryDerived: true,
      label: features.dominantMotionType,
    });
  }
  // Batch SC-6 - Motion Complexity (camera-motion half). dominantDirection
  // is deliberately NOT extracted here (see its own contract comment) -
  // motionTypeDiversity has the same "no calibrated view on which direction
  // is better" honesty as shakeScore, but unlike dominantDirection it IS a
  // plain 0-1 scalar with a defensible "more varied = more dynamic footage"
  // reading, so it's collected the same way shakeScore is.
  if (features.motionTypeDiversity !== null) {
    items.push({
      signal: 'cameraMotion',
      feature: 'motionTypeDiversity',
      value: features.motionTypeDiversity,
      isCategoryDerived: false,
    });
  }
  // Batch SC-7 - Motion Smoothness (Camera Jitter). Same "no calibrated
  // view on which direction is better" honesty as shakeScore itself - see
  // this field's own contract comment.
  if (features.smoothnessScore !== null) {
    items.push({
      signal: 'cameraMotion',
      feature: 'smoothnessScore',
      value: features.smoothnessScore,
      isCategoryDerived: false,
    });
  }
  return items;
}

// Taxonomy category F (Editing Rhythm) - a COMPOSITE signal (see
// @speedora/editing-rhythm's own module comment): tempoScore/pacingScore
// are already 0-1 by contract, accelerationScore is -1 to 1 (the only
// feature in this whole pipeline with that range so far) and gets mapped
// to 0-1 in NORMALIZERS below, not here - extraction only reports the raw
// value, normalization is a separate pipeline stage.
function extractEditingRhythmFeatures(
  features: EditingRhythmFeatures | undefined,
): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.tempoScore !== null) {
    items.push({
      signal: 'editingRhythm',
      feature: 'tempoScore',
      value: features.tempoScore,
      isCategoryDerived: false,
    });
  }
  if (features.pacingScore !== null) {
    items.push({
      signal: 'editingRhythm',
      feature: 'pacingScore',
      value: features.pacingScore,
      isCategoryDerived: false,
    });
  }
  if (features.accelerationScore !== null) {
    items.push({
      signal: 'editingRhythm',
      feature: 'accelerationScore',
      value: features.accelerationScore,
      isCategoryDerived: false,
    });
  }
  return items;
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

// AI Fusion roadmap's Face Intelligence initiative, Batch 1 - MediaPipe
// FaceLandmarker's blink/smile/mouth-open/head-rotation/framing features,
// distinct from extractFacialFeatures (expression classification via a
// separate model/subprocess). Every field maps 1:1 to a named feature, same
// "nothing collapsed into one opaque signal score" convention as every
// other extractor here - `visibilityScore` in particular is reported even
// though its own signal's weight is 0 (see weights.ts), for the same
// transparency reason gesture's features are.
function extractFaceGeometryFeatures(
  features: FaceLandmarkFeatures | undefined,
): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.blinkRate !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'blinkRate',
      value: features.blinkRate,
      isCategoryDerived: false,
    });
  }
  if (features.averageSmile !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageSmile',
      value: features.averageSmile,
      isCategoryDerived: false,
    });
  }
  if (features.averageMouthOpen !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageMouthOpen',
      value: features.averageMouthOpen,
      isCategoryDerived: false,
    });
  }
  if (features.averageAbsoluteYaw !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageAbsoluteYaw',
      value: features.averageAbsoluteYaw,
      isCategoryDerived: false,
    });
  }
  if (features.averageAbsolutePitch !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageAbsolutePitch',
      value: features.averageAbsolutePitch,
      isCategoryDerived: false,
    });
  }
  if (features.positionScore !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'positionScore',
      value: features.positionScore,
      isCategoryDerived: false,
    });
  }
  if (features.sizeScore !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'sizeScore',
      value: features.sizeScore,
      isCategoryDerived: false,
    });
  }
  if (features.visibilityScore !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'visibilityScore',
      value: features.visibilityScore,
      isCategoryDerived: false,
    });
  }
  // Batch 2 (Eye Contact/Looking Direction) - eyeContactRate is a plain
  // rate (like blinkRate above); dominantLookingDirection is category-
  // derived (like dominantEmotionWeight/dominantGestureWeight), mapped
  // through LOOKING_DIRECTION_WEIGHT.
  if (features.eyeContactRate !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'eyeContactRate',
      value: features.eyeContactRate,
      isCategoryDerived: false,
    });
  }
  if (features.dominantLookingDirection !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'dominantLookingDirectionWeight',
      value:
        LOOKING_DIRECTION_WEIGHT[features.dominantLookingDirection] ??
        DEFAULT_LOOKING_DIRECTION_WEIGHT,
      isCategoryDerived: true,
      label: features.dominantLookingDirection,
    });
  }
  // Batch 3 (Blur/Sharpness/Lighting/Occlusion) - averageSharpness/
  // averageBrightness are raw units (normalized below in NORMALIZERS,
  // same convention as averageAbsoluteYaw/Pitch); occlusionRate is
  // already a 0-1 rate like blinkRate/eyeContactRate.
  if (features.averageSharpness !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageSharpness',
      value: features.averageSharpness,
      isCategoryDerived: false,
    });
  }
  if (features.averageBrightness !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageBrightness',
      value: features.averageBrightness,
      isCategoryDerived: false,
    });
  }
  if (features.occlusionRate !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'occlusionRate',
      value: features.occlusionRate,
      isCategoryDerived: false,
    });
  }
  // Batch 4 (Face Re-identification/Tracking, Speaker Face Selection) -
  // speakerChangeCount/dominantSpeakerConsistency come from the trackId
  // sequence, speakerAudioSyncRate from correlating jawOpen against audio
  // timing (see @speedora/facial-intelligence's deriveFaceLandmarkFeatures).
  // All three normalized below (NORMALIZERS) same as every other feature
  // here; faceGeometry's overall signal weight is still 0 (see weights.ts),
  // so none of this moves a real score yet - reported for transparency the
  // same way visibilityScore already is.
  if (features.speakerChangeCount !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'speakerChangeCount',
      value: features.speakerChangeCount,
      isCategoryDerived: false,
    });
  }
  if (features.dominantSpeakerConsistency !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'dominantSpeakerConsistency',
      value: features.dominantSpeakerConsistency,
      isCategoryDerived: false,
    });
  }
  if (features.speakerAudioSyncRate !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'speakerAudioSyncRate',
      value: features.speakerAudioSyncRate,
      isCategoryDerived: false,
    });
  }
  // Batch 5A (Lip Activity) - temporal dynamics on top of averageMouthOpen
  // (already extracted above), all derived from the same jawOpen sequence.
  // Unlike Batch 4.5's telemetry, this IS a scoring signal (user's own
  // framing: high value for short-form video) - still faceGeometry's
  // shared weight (0, see weights.ts) until real data justifies otherwise.
  if (features.averageLipVelocity !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageLipVelocity',
      value: features.averageLipVelocity,
      isCategoryDerived: false,
    });
  }
  if (features.speakingIntensity !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'speakingIntensity',
      value: features.speakingIntensity,
      isCategoryDerived: false,
    });
  }
  if (features.pauseCount !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'pauseCount',
      value: features.pauseCount,
      isCategoryDerived: false,
    });
  }
  if (features.articulationRate !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'articulationRate',
      value: features.articulationRate,
      isCategoryDerived: false,
    });
  }
  // Batch 5B (Smile & Laugh) - averageMouthWidth/averageCheekRaise/
  // averageEyeSquint are plain measurements; genuineSmileRate is a coarse
  // Duchenne-marker heuristic (not category-derived - it's already a rate,
  // not a label-to-weight mapping like dominantEmotionWeight above).
  if (features.averageMouthWidth !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageMouthWidth',
      value: features.averageMouthWidth,
      isCategoryDerived: false,
    });
  }
  if (features.averageCheekRaise !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageCheekRaise',
      value: features.averageCheekRaise,
      isCategoryDerived: false,
    });
  }
  if (features.averageEyeSquint !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageEyeSquint',
      value: features.averageEyeSquint,
      isCategoryDerived: false,
    });
  }
  if (features.genuineSmileRate !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'genuineSmileRate',
      value: features.genuineSmileRate,
      isCategoryDerived: false,
    });
  }
  // Batch 5C (Blink & Eye Behavior) - blinkFrequencyPerMinute/
  // prolongedClosureCount are plain measurements; gazeStabilityScore is
  // already 0-1 by contract.
  if (features.blinkFrequencyPerMinute !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'blinkFrequencyPerMinute',
      value: features.blinkFrequencyPerMinute,
      isCategoryDerived: false,
    });
  }
  if (features.prolongedClosureCount !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'prolongedClosureCount',
      value: features.prolongedClosureCount,
      isCategoryDerived: false,
    });
  }
  if (features.gazeStabilityScore !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'gazeStabilityScore',
      value: features.gazeStabilityScore,
      isCategoryDerived: false,
    });
  }
  // Batch 5D (Emotion Heuristic) - averageBrowActivity/
  // averageHeadMovementRate are plain measurements; dominantAffect is
  // category-derived (same "attention-grabbing category weight" proxy as
  // dominantEmotionWeight/dominantGestureWeight/
  // dominantLookingDirectionWeight above, via AFFECT_WEIGHT);
  // affectConfidence is a coverage score, extracted the same way
  // peakConfidence is for facial/gesture.
  if (features.averageBrowActivity !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageBrowActivity',
      value: features.averageBrowActivity,
      isCategoryDerived: false,
    });
  }
  if (features.averageHeadMovementRate !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'averageHeadMovementRate',
      value: features.averageHeadMovementRate,
      isCategoryDerived: false,
    });
  }
  if (features.dominantAffect !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'dominantAffectWeight',
      value: AFFECT_WEIGHT[features.dominantAffect] ?? DEFAULT_AFFECT_WEIGHT,
      isCategoryDerived: true,
      label: features.dominantAffect,
    });
  }
  if (features.affectConfidence !== null) {
    items.push({
      signal: 'faceGeometry',
      feature: 'affectConfidence',
      value: features.affectConfidence,
      isCategoryDerived: false,
    });
  }
  return items;
}

// AI Fusion roadmap's OCR initiative, Batch OCR-2 - @speedora/ocr-
// intelligence's deriveOcrFeatures() output. Unlike faceGeometry/gesture
// (weight 0, collected-but-not-scored), `ocr` has carried a real weight
// (0.1) in DEFAULT_FUSION_WEIGHTS since Fase 31, reserved before any
// module existed to fill it - this is that module.
const OCR_CATEGORY_WEIGHT: Record<string, number> = {
  price: 90,
  name: 70,
  subtitle: 60,
  slide: 55,
  caption: 50,
  logo: 30,
};
const DEFAULT_OCR_CATEGORY_WEIGHT = 50;

function extractOcrFeatures(features: OcrFeatures | undefined): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.subtitleCoverageRate !== null) {
    items.push({
      signal: 'ocr',
      feature: 'subtitleCoverageRate',
      value: features.subtitleCoverageRate,
      isCategoryDerived: false,
    });
  }
  if (features.slidePresenceRate !== null) {
    items.push({
      signal: 'ocr',
      feature: 'slidePresenceRate',
      value: features.slidePresenceRate,
      isCategoryDerived: false,
    });
  }
  if (features.captionRate !== null) {
    items.push({
      signal: 'ocr',
      feature: 'captionRate',
      value: features.captionRate,
      isCategoryDerived: false,
    });
  }
  if (features.logoPresenceRate !== null) {
    items.push({
      signal: 'ocr',
      feature: 'logoPresenceRate',
      value: features.logoPresenceRate,
      isCategoryDerived: false,
    });
  }
  if (features.priceMentionRate !== null) {
    items.push({
      signal: 'ocr',
      feature: 'priceMentionRate',
      value: features.priceMentionRate,
      isCategoryDerived: false,
    });
  }
  if (features.nameMentionRate !== null) {
    items.push({
      signal: 'ocr',
      feature: 'nameMentionRate',
      value: features.nameMentionRate,
      isCategoryDerived: false,
    });
  }
  if (features.dominantTextCategory !== null) {
    items.push({
      signal: 'ocr',
      feature: 'dominantTextCategoryWeight',
      value: OCR_CATEGORY_WEIGHT[features.dominantTextCategory] ?? DEFAULT_OCR_CATEGORY_WEIGHT,
      isCategoryDerived: true,
      label: features.dominantTextCategory,
    });
  }
  if (features.averageTextBlockCount !== null) {
    items.push({
      signal: 'ocr',
      feature: 'averageTextBlockCount',
      value: features.averageTextBlockCount,
      isCategoryDerived: false,
    });
  }
  return items;
}

// Object Intelligence roadmap, Batch OI-1. Unlike OCR's dominantTextCategory
// above (a small, purpose-designed 6-category taxonomy with a defensible
// ordinal ranking), `dominantObject` draws from COCO's 80 generic,
// externally-fixed categories - there's no defensible "person is more
// engaging than a car" weight table the way OCR_CATEGORY_WEIGHT has one, so
// dominantObject is deliberately NOT extracted here, same reasoning as
// cameraMotion's dominantDirection. `objectCount` isn't extracted either
// (a raw count isn't duration-comparable across clips - averageObjectsPerFrame
// is the normalized version that already covers this, same "one
// representative scalar per concept" precedent as dynamicRatio/
// peakRatePerMinute).
function extractObjectFeatures(features: ObjectFeatures | undefined): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.averageObjectsPerFrame !== null) {
    items.push({
      signal: 'object',
      feature: 'averageObjectsPerFrame',
      value: features.averageObjectsPerFrame,
      isCategoryDerived: false,
    });
  }
  if (features.averageTrackingConfidence !== null) {
    items.push({
      signal: 'object',
      feature: 'averageTrackingConfidence',
      value: features.averageTrackingConfidence,
      isCategoryDerived: false,
    });
  }
  if (features.averagePersistence !== null) {
    items.push({
      signal: 'object',
      feature: 'averagePersistence',
      value: features.averagePersistence,
      isCategoryDerived: false,
    });
  }
  // Batch OI-2 - "more movement among tracked objects = more dynamic
  // footage" is a defensible ordinal reading, same reasoning sceneMotion's
  // averageMotionEnergy/peakRatePerMinute already carry - unlike
  // dominantObject, this is a plain numeric measurement, not a categorical
  // label needing a designed weight table.
  if (features.averageMotionSpeed !== null) {
    items.push({
      signal: 'object',
      feature: 'averageMotionSpeed',
      value: features.averageMotionSpeed,
      isCategoryDerived: false,
    });
  }
  // Batch OI-3 - same "no calibrated view on which direction is better"
  // honesty as cameraMotion's shakeScore/smoothnessScore: high occlusion
  // could mean cluttered/busy footage (a negative) or a naturally crowded,
  // socially engaging scene (a positive) - scored anyway, direction
  // deliberately left uninverted pending real engagement data.
  if (features.averageOcclusionScore !== null) {
    items.push({
      signal: 'object',
      feature: 'averageOcclusionScore',
      value: features.averageOcclusionScore,
      isCategoryDerived: false,
    });
  }
  // Batch OI-4 - same "uncalibrated heuristic" honesty as averageOcclusionScore
  // above, made explicit since this composite (proximity + temporal
  // co-presence + distance trend) has no depth/pose/action-recognition
  // grounding at all - it's a confidence that interaction is PLAUSIBLE, not
  // a validated engagement signal in either direction.
  if (features.averageInteractionConfidence !== null) {
    items.push({
      signal: 'object',
      feature: 'averageInteractionConfidence',
      value: features.averageInteractionConfidence,
      isCategoryDerived: false,
    });
  }
  // Batch OI-5 - a "domain of domains" composite (Visibility + Activity +
  // Social, see @speedora/contracts' objectTrackSchema for the full
  // architecture) over everything OI-1..4 already computed - same
  // "combine, don't re-detect" precedent as this file's own editingRhythm
  // extraction.
  if (features.averageAttentionScore !== null) {
    items.push({
      signal: 'object',
      feature: 'averageAttentionScore',
      value: features.averageAttentionScore,
      isCategoryDerived: false,
    });
  }
  // Extracted the same way facial/gesture's own peakConfidence is - the
  // shared 'peakConfidence' feature name is what computeHighlightScore()'s
  // computeConfidence() looks for to fold a signal's own reliability into
  // the Fusion Engine's overall confidence, not just into the weighted
  // score. attentionConfidence is exactly that kind of number (how much
  // observation backs the attentionScore reading above), so it reuses the
  // name rather than introducing a parallel, unrecognized one.
  if (features.averageAttentionConfidence !== null) {
    items.push({
      signal: 'object',
      feature: 'peakConfidence',
      value: features.averageAttentionConfidence,
      isCategoryDerived: false,
    });
  }
  return items;
}

export function extractFeatures(input: FusionInput): ExtractedFeature[] {
  return [
    ...extractAudioFeatures(input.audio),
    ...extractSceneFeatures(input.scene),
    ...extractMotionEnergyFeatures(input.sceneMotion),
    ...extractCameraMotionFeatures(input.cameraMotion),
    ...extractEditingRhythmFeatures(input.editingRhythm),
    ...extractFacialFeatures(input.facial),
    ...extractGestureFeatures(input.gesture),
    ...extractFaceGeometryFeatures(input.faceGeometry),
    ...extractOcrFeatures(input.ocr),
    ...extractObjectFeatures(input.object),
    ...extractLlmFeatures(input.llm),
    ...extractSpeakerFeatures(input.speaker),
  ];
}

// Speaker Intelligence roadmap, Milestone D - a COMPOSITE signal (like
// editingRhythm), every field a plain [0,1]-or-null measurement, same
// "only push what's non-null" pattern as extractAudioFeatures above (no
// category-derived weight table here either).
function extractSpeakerFeatures(features: SpeakerFusionFeatures | undefined): ExtractedFeature[] {
  if (!features) return [];
  const items: ExtractedFeature[] = [];
  if (features.dominantSpeakerConfidence !== null) {
    items.push({
      signal: 'speaker',
      feature: 'dominantSpeakerConfidence',
      value: features.dominantSpeakerConfidence,
      isCategoryDerived: false,
    });
  }
  if (features.dominantSpeakerEngagement !== null) {
    items.push({
      signal: 'speaker',
      feature: 'dominantSpeakerEngagement',
      value: features.dominantSpeakerEngagement,
      isCategoryDerived: false,
    });
  }
  if (features.dominantSpeakerImportance !== null) {
    items.push({
      signal: 'speaker',
      feature: 'dominantSpeakerImportance',
      value: features.dominantSpeakerImportance,
      isCategoryDerived: false,
    });
  }
  if (features.averageSpeakerHighlightScore !== null) {
    items.push({
      signal: 'speaker',
      feature: 'averageSpeakerHighlightScore',
      value: features.averageSpeakerHighlightScore,
      isCategoryDerived: false,
    });
  }
  return items;
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

// Batch SC-2 (Scene Intelligence taxonomy expansion) - ffmpeg signalstats'
// YDIF at/above this reads as "maximally dynamic" motion energy - a
// reasonable guess (0-255 luma scale; sustained handheld/action footage
// commonly reads well above single digits), NOT calibrated against real
// footage, same caveat as every other cap in this file.
const MOTION_ENERGY_CAP = 20;
// Batch SC-5 (Scene Intelligence taxonomy expansion, continuing SC-2) -
// motion-energy peaks/minute at/above which a clip reads as "maximally
// spiky" - a reasonable guess (a fast-cut highlight reel might spike several
// times per minute; a static talking-head clip typically has none), NOT
// calibrated against real footage, same caveat as every other cap here.
const PEAK_RATE_PER_MINUTE_CAP = 6;
// Batch SC-6 (Scene Intelligence taxonomy expansion, continuing SC-2/SC-5) -
// coefficient of variation at/above which motion-energy reads as "maximally
// erratic" - a reasonable guess (a CoV of 1 means the stddev equals the
// mean, already a wide swing for a physical magnitude measurement), NOT
// calibrated against real footage, same caveat as every other cap here.
const MOTION_VARIABILITY_CAP = 1.5;

// clip-scoring's LLM output is already 0-100 by contract (clampScores()
// there), so every llm.* normalizer is the same plain /100 divide - listed
// individually (rather than a wildcard match) so an unrecognized feature
// name still throws instead of silently normalizing.
const LLM_SCORE_NORMALIZER = (value: number) => clamp(value / 100, 0, 1);

// Degrees of head yaw/pitch above which "looking away from camera" is
// already at its most extreme reportable value - same "reasonable cap,
// not calibrated against real footage" caveat as AUDIO_QUIET_DB/
// SCENE_CUTS_PER_MINUTE_CAP above. This normalizes MAGNITUDE of rotation
// (0 = facing camera, 1 = at/past the cap), not a judgment of whether
// looking away is good or bad for a given clip.
const HEAD_ROTATION_CAP_DEGREES = 45;

// Batch 3 (Blur/Sharpness/Lighting) - Laplacian variance at/above this is
// already fully "sharp" (1.0); a reasonable guess for typical video frame
// content/resolution, not calibrated against real footage (same caveat as
// every other cap in this file).
const SHARPNESS_CAP = 500;

// Batch 3 (Lighting) - unlike sharpness/cuts-per-minute (more is simply
// "more"), brightness has a middle-is-best shape: too dark OR too bright
// are both worse than a well-lit middle range. BRIGHTNESS_IDEAL scores 1;
// TOO_DARK/TOO_BRIGHT score 0; linear ramps between. Reasonable guesses on
// a 0-255 grayscale scale, not calibrated against real footage.
const BRIGHTNESS_TOO_DARK = 40;
const BRIGHTNESS_IDEAL = 140;
const BRIGHTNESS_TOO_BRIGHT = 220;

function brightnessScore(value: number): number {
  if (value <= BRIGHTNESS_TOO_DARK || value >= BRIGHTNESS_TOO_BRIGHT) return 0;
  if (value <= BRIGHTNESS_IDEAL) {
    return clamp(mapRange(value, BRIGHTNESS_TOO_DARK, BRIGHTNESS_IDEAL, 0, 1), 0, 1);
  }
  return clamp(mapRange(value, BRIGHTNESS_IDEAL, BRIGHTNESS_TOO_BRIGHT, 1, 0), 0, 1);
}

// Batch 4 (Face Re-identification/Tracking) - same "more is simply more, up
// to a reasonable cap" treatment as SCENE_CUTS_PER_MINUTE_CAP, and for the
// same honest reason: this codebase has no calibrated view on whether a
// visible-speaker change within a single short clip is inherently good
// (dynamic, multi-person content) or bad (unstable tracking) - so it's
// scored the same direction as scene cuts rather than inverted, pending
// real data. dominantSpeakerConsistency is the complementary "stability"
// read and is scored in the opposite direction (more consistent = better)
// since that one IS unambiguous.
const SPEAKER_CHANGE_CAP = 5;

// Batch 5A (Lip Activity) - reasonable guesses, not calibrated against real
// footage, same "kejujuran skala" as every other cap in this file.
// LIP_VELOCITY_CAP: blendshape-units/sec at/above which mouth movement
// reads as "maximally active" (a full 0->1 jawOpen swing in ~2 seconds).
const LIP_VELOCITY_CAP = 0.5;
// ARTICULATION_RATE_CAP: direction reversals/sec at/above which jawOpen is
// oscillating "maximally rapidly".
const ARTICULATION_RATE_CAP = 2;
// PAUSE_COUNT_CAP: same "more is simply more, direction unproven" honesty
// as SPEAKER_CHANGE_CAP - this codebase has no calibrated view on whether
// mid-clip pauses are a good (dramatic effect) or bad (dead air) sign for a
// short clip, so it's scored the same uninverted direction as speaker
// changes/scene cuts, pending real data.
const PAUSE_COUNT_CAP = 5;

// Batch 5B (Smile & Laugh) - a mouth-width ratio (corner-to-corner distance
// / inter-ocular baseline, see face-landmarks.ts) at/above this reads as
// "maximally wide" (a broad, expressive smile) - a reasonable guess, not
// calibrated against real footage, same caveat as every other cap here.
const MOUTH_WIDTH_CAP = 1.0;

// Batch 5C (Blink & Eye Behavior) - reasonable guesses, not calibrated
// against real footage. BLINK_FREQUENCY_CAP: blinks/minute at/above which
// blink frequency reads as "maximally high" (typical resting blink rate is
// roughly 15-20/min, so this is a generous upper band).
// PROLONGED_CLOSURE_CAP: same "more is simply more, direction unproven"
// honesty as PAUSE_COUNT_CAP/SPEAKER_CHANGE_CAP.
const BLINK_FREQUENCY_CAP = 30;
const PROLONGED_CLOSURE_CAP = 5;

// Batch 5D (Emotion Heuristic) - degrees/sec of combined pitch+yaw+roll
// change at/above which head movement reads as "maximally dynamic" - same
// VALUE as @speedora/facial-intelligence's own HEAD_MOVEMENT_RATE_CAP,
// duplicated (not imported - separate packages, and that copy serves a
// different purpose: normalizing this SAME raw signal for its own internal
// dominantAffect decision tree, not for the Fusion Engine's scoring).
const HEAD_MOVEMENT_RATE_CAP = 30;

// AI Fusion roadmap's OCR initiative, Batch OCR-2 - text blocks/sampled-
// frame at/above which on-screen text density reads as "maximally dense" -
// a reasonable guess (a typical talking-head clip might show 0-2 blocks at
// once: one subtitle line plus maybe a logo), not calibrated against real
// footage, same caveat as every other cap in this file.
const AVERAGE_TEXT_BLOCK_COUNT_CAP = 3;

// Object Intelligence roadmap, Batch OI-1 - detected objects/sampled-frame
// at/above which object density reads as "maximally busy" - a reasonable
// guess (a typical talking-head clip might show 1-2 objects: the speaker
// plus maybe a prop), not calibrated against real footage, same caveat as
// every other cap in this file.
const AVERAGE_OBJECT_COUNT_CAP = 3;

const NORMALIZERS: Record<string, (value: number) => number> = {
  averageRmsDb: (value) => clamp(mapRange(value, AUDIO_QUIET_DB, AUDIO_LOUD_DB, 0, 1), 0, 1),
  speakingRateStdDev: (value) => clamp(mapRange(value, 0, SPEAKING_RATE_STD_DEV_CAP, 0, 1), 0, 1),
  cutsPerMinute: (value) =>
    clamp(mapRange(value, 0, SCENE_CUTS_PER_MINUTE_CAP, SCENE_BASELINE, 1), 0, 1),
  // Batch SC-2 (Scene Intelligence taxonomy expansion).
  averageMotionEnergy: (value) => clamp(mapRange(value, 0, MOTION_ENERGY_CAP, 0, 1), 0, 1),
  // Already 0-1 by contract (MotionEnergyFeatures.dynamicRatio).
  dynamicRatio: (value) => clamp(value, 0, 1),
  // Batch SC-5 (Scene Intelligence taxonomy expansion).
  peakRatePerMinute: (value) => clamp(mapRange(value, 0, PEAK_RATE_PER_MINUTE_CAP, 0, 1), 0, 1),
  // Batch SC-6 (Scene Intelligence taxonomy expansion).
  motionVariability: (value) => clamp(mapRange(value, 0, MOTION_VARIABILITY_CAP, 0, 1), 0, 1),
  // Batch SC-3 - already 0-1 by contract (CameraMotionFeatures - see
  // scene-intelligence.ts).
  panScore: (value) => clamp(value, 0, 1),
  tiltScore: (value) => clamp(value, 0, 1),
  zoomScore: (value) => clamp(value, 0, 1),
  shakeScore: (value) => clamp(value, 0, 1),
  dominantMotionTypeWeight: (value) => clamp(value / 100, 0, 1),
  // Batch SC-6 - already 0-1 by contract (CameraMotionFeatures.motionTypeDiversity).
  motionTypeDiversity: (value) => clamp(value, 0, 1),
  // Batch SC-7 - already 0-1 by contract (CameraMotionFeatures.smoothnessScore).
  smoothnessScore: (value) => clamp(value, 0, 1),
  // Taxonomy category F (Editing Rhythm) - tempoScore/pacingScore already
  // 0-1 by contract. accelerationScore is -1 to 1 (concentrated-first-half
  // to concentrated-second-half) - the only feature normalized from a
  // signed range in this pipeline so far, mapped linearly to 0-1 (0 =
  // fully first-half-concentrated, 1 = fully second-half-concentrated,
  // 0.5 = evenly split) rather than treating "accelerating" as
  // inherently better/worse than "decelerating".
  tempoScore: (value) => clamp(value, 0, 1),
  pacingScore: (value) => clamp(value, 0, 1),
  accelerationScore: (value) => clamp(mapRange(value, -1, 1, 0, 1), 0, 1),
  dominantEmotionWeight: (value) => clamp(value / 100, 0, 1),
  dominantGestureWeight: (value) => clamp(value / 100, 0, 1),
  // Already 0-1 by contract (facial/gesture peakConfidence/stability).
  peakConfidence: (value) => clamp(value, 0, 1),
  stability: (value) => clamp(value, 0, 1),
  // Already 0-1 by contract (FaceLandmarkFeatures - see face-landmarks.ts).
  blinkRate: (value) => clamp(value, 0, 1),
  averageSmile: (value) => clamp(value, 0, 1),
  averageMouthOpen: (value) => clamp(value, 0, 1),
  positionScore: (value) => clamp(value, 0, 1),
  sizeScore: (value) => clamp(value, 0, 1),
  visibilityScore: (value) => clamp(value, 0, 1),
  averageAbsoluteYaw: (value) => clamp(mapRange(value, 0, HEAD_ROTATION_CAP_DEGREES, 0, 1), 0, 1),
  averageAbsolutePitch: (value) => clamp(mapRange(value, 0, HEAD_ROTATION_CAP_DEGREES, 0, 1), 0, 1),
  // Already 0-1 by contract (FaceLandmarkFeatures.eyeContactRate).
  eyeContactRate: (value) => clamp(value, 0, 1),
  dominantLookingDirectionWeight: (value) => clamp(value / 100, 0, 1),
  averageSharpness: (value) => clamp(mapRange(value, 0, SHARPNESS_CAP, 0, 1), 0, 1),
  averageBrightness: brightnessScore,
  // Inverted (1 - rate), NOT a passthrough - occlusionRate's raw semantics
  // are "higher = more occluded" (a problem), but every other feature here
  // follows "higher normalizedValue = better" (positionScore/sizeScore/
  // eyeContactRate) - inverting keeps that convention consistent so a
  // future non-zero weight moves the score the right direction without
  // needing a special case.
  occlusionRate: (value) => clamp(1 - value, 0, 1),
  speakerChangeCount: (value) => clamp(mapRange(value, 0, SPEAKER_CHANGE_CAP, 0, 1), 0, 1),
  // Already 0-1 by contract (FaceLandmarkFeatures - see face-landmarks.ts).
  dominantSpeakerConsistency: (value) => clamp(value, 0, 1),
  speakerAudioSyncRate: (value) => clamp(value, 0, 1),
  averageLipVelocity: (value) => clamp(mapRange(value, 0, LIP_VELOCITY_CAP, 0, 1), 0, 1),
  // Already 0-1 by contract (FaceLandmarkFeatures.speakingIntensity).
  speakingIntensity: (value) => clamp(value, 0, 1),
  pauseCount: (value) => clamp(mapRange(value, 0, PAUSE_COUNT_CAP, 0, 1), 0, 1),
  articulationRate: (value) => clamp(mapRange(value, 0, ARTICULATION_RATE_CAP, 0, 1), 0, 1),
  averageMouthWidth: (value) => clamp(mapRange(value, 0, MOUTH_WIDTH_CAP, 0, 1), 0, 1),
  // Already 0-1 by contract (FaceLandmarkFeatures - see face-landmarks.ts).
  averageCheekRaise: (value) => clamp(value, 0, 1),
  averageEyeSquint: (value) => clamp(value, 0, 1),
  genuineSmileRate: (value) => clamp(value, 0, 1),
  blinkFrequencyPerMinute: (value) => clamp(mapRange(value, 0, BLINK_FREQUENCY_CAP, 0, 1), 0, 1),
  prolongedClosureCount: (value) => clamp(mapRange(value, 0, PROLONGED_CLOSURE_CAP, 0, 1), 0, 1),
  // Already 0-1 by contract (FaceLandmarkFeatures.gazeStabilityScore).
  gazeStabilityScore: (value) => clamp(value, 0, 1),
  averageBrowActivity: (value) => clamp(value, 0, 1),
  averageHeadMovementRate: (value) => clamp(mapRange(value, 0, HEAD_MOVEMENT_RATE_CAP, 0, 1), 0, 1),
  dominantAffectWeight: (value) => clamp(value / 100, 0, 1),
  affectConfidence: (value) => clamp(value, 0, 1),
  // Already 0-1 by contract (OcrFeatures - see ocr.ts).
  subtitleCoverageRate: (value) => clamp(value, 0, 1),
  slidePresenceRate: (value) => clamp(value, 0, 1),
  captionRate: (value) => clamp(value, 0, 1),
  logoPresenceRate: (value) => clamp(value, 0, 1),
  priceMentionRate: (value) => clamp(value, 0, 1),
  nameMentionRate: (value) => clamp(value, 0, 1),
  dominantTextCategoryWeight: (value) => clamp(value / 100, 0, 1),
  averageTextBlockCount: (value) =>
    clamp(mapRange(value, 0, AVERAGE_TEXT_BLOCK_COUNT_CAP, 0, 1), 0, 1),
  // Object Intelligence roadmap, Batch OI-1.
  averageObjectsPerFrame: (value) =>
    clamp(mapRange(value, 0, AVERAGE_OBJECT_COUNT_CAP, 0, 1), 0, 1),
  // Already 0-1 by contract (ObjectFeatures) - averageMotionSpeed is
  // normalized at derive time in track-objects.ts (OBJECT_MOTION_CAP),
  // same convention as averageTrackingConfidence/averagePersistence.
  averageTrackingConfidence: (value) => clamp(value, 0, 1),
  averagePersistence: (value) => clamp(value, 0, 1),
  averageMotionSpeed: (value) => clamp(value, 0, 1),
  // Batch OI-3 - already 0-1 by contract (an IoU value can't exceed 1).
  averageOcclusionScore: (value) => clamp(value, 0, 1),
  // Batch OI-4 - already 0-1 by contract (a mean of three [0,1] components).
  averageInteractionConfidence: (value) => clamp(value, 0, 1),
  // Batch OI-5 - already 0-1 by contract (a mean of three [0,1] domain
  // scores). averageAttentionConfidence reuses the peakConfidence normalizer
  // above (same feature name, see extractObjectFeatures()).
  averageAttentionScore: (value) => clamp(value, 0, 1),
  'engagement.hookStrength': LLM_SCORE_NORMALIZER,
  'engagement.curiosity': LLM_SCORE_NORMALIZER,
  'engagement.emotion': LLM_SCORE_NORMALIZER,
  'engagement.storytelling': LLM_SCORE_NORMALIZER,
  'knowledge.educationalValue': LLM_SCORE_NORMALIZER,
  'knowledge.practicalValue': LLM_SCORE_NORMALIZER,
  'knowledge.novelty': LLM_SCORE_NORMALIZER,
  'knowledge.trustAuthority': LLM_SCORE_NORMALIZER,
  'conversion.ctaStrength': LLM_SCORE_NORMALIZER,
  // Already 0-1 by contract (SpeakerFusionFeatures - see speaker-scoring.ts).
  dominantSpeakerConfidence: (value) => clamp(value, 0, 1),
  dominantSpeakerEngagement: (value) => clamp(value, 0, 1),
  dominantSpeakerImportance: (value) => clamp(value, 0, 1),
  averageSpeakerHighlightScore: (value) => clamp(value, 0, 1),
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
