import type { MotionEnergyFeatures, MotionEnergySample } from '@speedora/contracts';

// A sample's motionEnergy at/below this reads as "static" for the Static/
// Dynamic Scene classification in the user's taxonomy - a reasonable guess
// (YDIF is a 0-255 luma scale; a locked-off talking-head shot with only
// lighting flicker/compression noise typically stays in the low single
// digits), NOT calibrated against real footage - same "kejujuran skala" as
// every other threshold in this pipeline (FADE_PROXIMITY_SECONDS,
// SILENCE_RMS_DB_THRESHOLD, etc.).
const STATIC_DYNAMIC_THRESHOLD = 4;

// Batch SC-5 (Scene Intelligence taxonomy expansion, continuing SC-1..SC-4) -
// Motion Peak Detection. A sample counts as a "peak" (an activity spike
// worth surfacing, e.g. for an editor jump-to-highlight UI) when it's a
// strict local maximum among its immediate neighbors AND its motionEnergy
// clears the clip's own mean by a multiple of the clip's own stddev - a
// self-relative threshold (not an absolute YDIF value) since motionEnergy
// itself "isn't comparable across different source footage" (see this
// schema field's own contract comment). PEAK_STDDEV_MULTIPLIER is a
// reasonable guess, NOT calibrated against real footage - same "kejujuran
// skala" as STATIC_DYNAMIC_THRESHOLD above and every other threshold in this
// pipeline.
const PEAK_STDDEV_MULTIPLIER = 1.5;

// Shared by peak detection (SC-5) and motionVariability (SC-6) - both are
// self-relative measurements (a spike threshold, a variation ratio) derived
// from the same clip-level mean/stddev, so it's computed once rather than
// twice over the same `values` array.
function meanAndStddev(values: number[]): { mean: number; stddev: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

function findPeakIndices(values: number[], mean: number, stddev: number): number[] {
  // A perfectly flat signal (stddev === 0) has no meaningful "spike" -
  // every sample is equally the mean, so none of them qualify as a peak.
  if (stddev === 0) return [];

  const peakThreshold = mean + PEAK_STDDEV_MULTIPLIER * stddev;
  const peakIndices: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value < peakThreshold) continue;
    const previous = i > 0 ? values[i - 1] : null;
    const next = i < values.length - 1 ? values[i + 1] : null;
    const clearsPrevious = previous === null || value > previous;
    const clearsNext = next === null || value > next;
    if (clearsPrevious && clearsNext) peakIndices.push(i);
  }
  return peakIndices;
}

// Pure, synchronous summary derivation over analyzeMotionEnergy()'s raw
// `samples` array - a separate function from the subprocess-calling one,
// same reason as every other deriveXFeatures in this pipeline (see
// packages/contracts/src/intelligence-signal.ts).
//
// `clipDurationSeconds` (Batch SC-5) follows the same explicit-parameter
// precedent as deriveSceneFeatures' own `clipDurationSeconds` - needed to
// turn peakCount into a duration-normalized peakRatePerMinute, same
// cutsPerMinute reasoning.
export function deriveMotionEnergyFeatures(
  samples: MotionEnergySample[],
  clipDurationSeconds: number,
): MotionEnergyFeatures {
  if (samples.length === 0) {
    return {
      averageMotionEnergy: null,
      peakMotionEnergy: null,
      staticRatio: null,
      dynamicRatio: null,
      peakCount: null,
      peakTimestamps: null,
      peakRatePerMinute: null,
      motionVariability: null,
    };
  }

  const values = samples.map((sample) => sample.motionEnergy);
  const { mean: averageMotionEnergy, stddev } = meanAndStddev(values);
  const peakMotionEnergy = Math.max(...values);
  const staticCount = values.filter((value) => value <= STATIC_DYNAMIC_THRESHOLD).length;
  const staticRatio = staticCount / values.length;
  const dynamicRatio = 1 - staticRatio;

  const peakIndices = findPeakIndices(values, averageMotionEnergy, stddev);
  const peakCount = peakIndices.length;
  const peakTimestamps = peakIndices.map((index) => samples[index].t);
  const peakRatePerMinute =
    clipDurationSeconds > 0 ? (peakCount / clipDurationSeconds) * 60 : null;

  // Batch SC-6 - Motion Complexity (motion-energy half). Coefficient of
  // variation, null when the mean is 0 (a clip whose motionEnergy is
  // uniformly 0 has no meaningful ratio to report, not a fabricated 0 or
  // Infinity).
  const motionVariability = averageMotionEnergy > 0 ? stddev / averageMotionEnergy : null;

  return {
    averageMotionEnergy,
    peakMotionEnergy,
    staticRatio,
    dynamicRatio,
    peakCount,
    peakTimestamps,
    peakRatePerMinute,
    motionVariability,
  };
}
