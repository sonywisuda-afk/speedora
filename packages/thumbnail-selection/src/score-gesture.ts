import type { GestureSample } from '@speedora/contracts';

// A named (non-'none') gesture is a deliberate, attention-grabbing on-camera
// moment - scored by the recognizer's own confidence, same "no fabricated
// certainty" convention as every other confidence-scaled signal in this
// pipeline. 'none' (a hand detected but no recognized gesture) and null
// (no hand at all) are both absent from the returned map, not penalized.
export function scoreGesture(samples: GestureSample[] | null): Map<number, number> {
  const scores = new Map<number, number>();
  for (const sample of samples ?? []) {
    if (sample.gesture === null || sample.gesture === 'none' || sample.confidence === null) {
      continue;
    }
    scores.set(sample.t, sample.confidence);
  }
  return scores;
}
