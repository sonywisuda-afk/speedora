import type { FaceLandmarkSample } from '@speedora/contracts';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Reasonable guesses, NOT calibrated against real footage - same values as
// @speedora/fusion-engine's own SHARPNESS_CAP/HEAD_ROTATION_CAP_DEGREES,
// duplicated (not imported) since this package has no cross-signal-package
// dependency, same convention as editing-rhythm/composition-intelligence's
// own duplicated caps.
const SHARPNESS_CAP = 500;
// |yaw| + |pitch| at/above which a face already reads as maximally turned
// away from camera - each axis capped at fusion-engine's own
// HEAD_ROTATION_CAP_DEGREES (45), summed since this scores COMBINED
// off-axis rotation, not either axis alone.
const FRONTAL_OFFSET_CAP_DEGREES = 90;

// A good thumbnail wants a clear, forward-facing, smiling face - not a
// blurred/turned/blank one. Averages whichever of sharpness/frontal-ness/
// smile are available per sample (same "average what exists" pattern as
// calculateTempo), so a sample missing one raw field isn't zeroed out.
// Samples with no detected face (`boundingBox` null) are excluded entirely,
// not scored 0 - no face at this instant means "no reading", not "bad".
export function scoreFaceClarity(samples: FaceLandmarkSample[] | null): Map<number, number> {
  const scores = new Map<number, number>();
  for (const sample of samples ?? []) {
    if (!sample.boundingBox) continue;
    const components: number[] = [];
    if (sample.sharpness !== null) {
      components.push(clamp01(sample.sharpness / SHARPNESS_CAP));
    }
    if (sample.rotation !== null) {
      const offAxis = Math.abs(sample.rotation.yaw) + Math.abs(sample.rotation.pitch);
      components.push(1 - clamp01(offAxis / FRONTAL_OFFSET_CAP_DEGREES));
    }
    if (sample.blendshapes !== null) {
      components.push((sample.blendshapes.mouthSmileLeft + sample.blendshapes.mouthSmileRight) / 2);
    }
    if (components.length === 0) continue;
    scores.set(sample.t, components.reduce((sum, value) => sum + value, 0) / components.length);
  }
  return scores;
}
