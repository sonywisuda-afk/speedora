import type {
  CameraMotionSample,
  ComputeMomentumCurveInput,
  MomentumCurve,
  NarrativeGraph,
  NarrativeSegment,
} from '@speedora/contracts';
import { momentumMultiplierForSegmentType } from './segment-type-multiplier';

// Every constant below is a documented HEURISTIC (ADR D4) - not derived
// from any real engagement data. Chosen so the always-available `base`
// term dominates and the optional terms only nudge the curve.
const CAMERA_BOOST_WEIGHT = 0.2;
const ACCELERATION_BIAS_WEIGHT = 0.15;

// Camera motion magnitude cap for normalization - dx/dy are fractions of
// frame width/height, scale is a multiplicative factor around 1. A
// reasonable, unvalidated ceiling, same "kejujuran skala" honesty as every
// other cap in this pipeline.
const CAMERA_MAGNITUDE_CAP = 0.3;

// How close (seconds) a cameraMotionSample must be to a motionEnergy
// sample's own timestamp to count as "concurrent" - both are sampled at
// roughly the same ~1s cadence, so this is a generous tolerance, not a
// precise alignment requirement.
const CAMERA_SAMPLE_MATCH_WINDOW_SECONDS = 1.5;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Min-max normalizes `values` to [0, 1] RELATIVE to this clip's own range -
// motion energy isn't comparable across clips (see motionEnergySampleSchema's
// own doc comment in @speedora/contracts), so this is deliberately relative,
// not an absolute scale. Returns an all-0 array when every value is
// identical (nothing to compare) rather than dividing by zero.
function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map((value) => (value - min) / (max - min));
}

function findNearestCameraMotion(
  t: number,
  cameraMotionSamples: CameraMotionSample[],
): CameraMotionSample | null {
  let nearest: CameraMotionSample | null = null;
  let nearestDistance = Infinity;
  for (const sample of cameraMotionSamples) {
    const distance = Math.abs(sample.t - t);
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }
  return nearest && nearestDistance <= CAMERA_SAMPLE_MATCH_WINDOW_SECONDS ? nearest : null;
}

function cameraMotionMagnitude(sample: CameraMotionSample): number {
  if (sample.dx === null || sample.dy === null || sample.scale === null) {
    return 0;
  }
  const magnitude = Math.abs(sample.dx) + Math.abs(sample.dy) + Math.abs(sample.scale - 1);
  return clamp01(magnitude / CAMERA_MAGNITUDE_CAP);
}

// Degrades to `null` (a neutral 1.0 multiplier) when narrativeGraph is
// absent OR unsegmented OR `t` falls outside every segment - same
// "optional context, never a hard dependency" pattern Phase 3 used for
// semanticEvents.
function segmentAt(t: number, narrativeGraph: NarrativeGraph | null): NarrativeSegment | null {
  if (!narrativeGraph || narrativeGraph.unsegmented) {
    return null;
  }
  return (
    narrativeGraph.segments.find((segment) => t >= segment.startTime && t < segment.endTime) ?? null
  );
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter at all (the first
// v4 module with no LLM call). Combines already-computed signals into one
// relative momentum timeline:
//   1. base - this sample's own motionEnergy, min-max normalized within
//      this clip's own samples.
//   2. camera boost - the nearest concurrent camera-motion sample's
//      movement magnitude, when available.
//   3. acceleration bias - a linear ramp across the clip's duration scaled
//      by EditingRhythmFeatures.accelerationScore, when available.
//   4. narrative multiplier - a per-segment-type boost/reduction from
//      Phase 3's NarrativeGraph, when available and not unsegmented.
export function computeMomentumCurve(input: ComputeMomentumCurveInput): MomentumCurve {
  if (input.motionEnergySamples.length === 0) {
    return [];
  }

  const baseValues = minMaxNormalize(
    input.motionEnergySamples.map((sample) => sample.motionEnergy),
  );

  return input.motionEnergySamples.map((sample, index) => {
    const base = baseValues[index];

    const cameraSample = input.cameraMotionSamples
      ? findNearestCameraMotion(sample.t, input.cameraMotionSamples)
      : null;
    const cameraBoost = cameraSample ? cameraMotionMagnitude(cameraSample) : 0;

    const accelerationBias =
      input.accelerationScore !== null && input.clipDurationSeconds > 0
        ? (sample.t / input.clipDurationSeconds) * input.accelerationScore
        : 0;

    const segment = segmentAt(sample.t, input.narrativeGraph);
    const narrativeMultiplier = segment ? momentumMultiplierForSegmentType(segment.type) : 1.0;

    const combined =
      base + CAMERA_BOOST_WEIGHT * cameraBoost + ACCELERATION_BIAS_WEIGHT * accelerationBias;

    return {
      t: sample.t,
      momentumScore: clamp01(combined * narrativeMultiplier),
    };
  });
}
