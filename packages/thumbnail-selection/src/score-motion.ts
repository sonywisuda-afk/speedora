import type { MotionEnergySample, SceneCutEvent } from '@speedora/contracts';

// Same PEAK_STDDEV_MULTIPLIER rule @speedora/scene-intelligence's
// derive-motion-energy-features.ts already uses to find local motion-energy
// peaks, duplicated here (not imported) - no cross-signal-package
// dependency, same convention as every other calculate-*/score-* file in
// this pipeline.
const PEAK_STDDEV_MULTIPLIER = 1.5;
// A frame this close to a hard cut/fade/dissolve is a transition artifact,
// not a good static thumbnail moment - a reasonable guess, not calibrated
// against real footage, same "kejujuran skala" as every cap in this file.
const MIN_CUT_DISTANCE_SECONDS = 0.5;

function meanAndStddev(values: number[]): { mean: number; stddev: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

// A motion-energy PEAK (a local maximum clearing the clip's own mean +
// stddev threshold, same self-relative rule as scene-intelligence's own
// peak detection - motionEnergy isn't comparable across different source
// footage) reads as an energetic, dynamic moment worth surfacing - unless
// it's too close to a scene cut, where it's more likely a transition
// artifact than a genuinely dynamic in-shot moment. Every qualifying peak
// scores a flat 1 (this signal is binary - "is this instant a peak or
// not" - not a graded measurement), same "not this signal's own gradient"
// possible convention.
export function scoreMotion(
  samples: MotionEnergySample[] | null,
  sceneCutEvents: SceneCutEvent[] | null,
): Map<number, number> {
  const scores = new Map<number, number>();
  const values = samples ?? [];
  if (values.length === 0) return scores;

  const { mean, stddev } = meanAndStddev(values.map((sample) => sample.motionEnergy));
  if (stddev === 0) return scores;
  const peakThreshold = mean + PEAK_STDDEV_MULTIPLIER * stddev;

  for (let i = 0; i < values.length; i++) {
    const sample = values[i];
    if (sample.motionEnergy < peakThreshold) continue;
    const previous = i > 0 ? values[i - 1] : null;
    const next = i < values.length - 1 ? values[i + 1] : null;
    const clearsPrevious = previous === null || sample.motionEnergy > previous.motionEnergy;
    const clearsNext = next === null || sample.motionEnergy > next.motionEnergy;
    if (!clearsPrevious || !clearsNext) continue;

    const nearCut = (sceneCutEvents ?? []).some(
      (event) => Math.abs(event.t - sample.t) < MIN_CUT_DISTANCE_SECONDS,
    );
    if (nearCut) continue;

    scores.set(sample.t, 1);
  }
  return scores;
}
