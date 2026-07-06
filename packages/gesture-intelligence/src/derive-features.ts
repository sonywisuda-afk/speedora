import type { Gesture, GestureFeatures, GestureSample } from '@speedora/contracts';

type ClassifiedSample = { t: number; gesture: Gesture; confidence: number };

// Pure, synchronous summary derivation over detectGestures()'s raw
// per-sample output - same math/structure as
// @speedora/facial-intelligence's deriveFacialEmotionFeatures(), mirrored
// rather than shared since the two taxonomies are conceptually distinct
// (see packages/contracts/src/intelligence-signal.ts for why this
// raw/features split exists).
export function deriveGestureFeatures(samples: GestureSample[]): GestureFeatures {
  const classified = samples.filter(
    (sample): sample is ClassifiedSample => sample.gesture !== null && sample.confidence !== null,
  );

  if (classified.length === 0) {
    return { dominantGesture: null, gestureTransitions: 0, peakConfidence: null, stability: null };
  }

  const counts = new Map<string, number>();
  for (const sample of classified) {
    counts.set(sample.gesture, (counts.get(sample.gesture) ?? 0) + 1);
  }

  // First-occurrence tie-break, same reasoning as facial-intelligence.
  let dominantGesture = classified[0].gesture;
  let dominantCount = 0;
  for (const sample of classified) {
    const count = counts.get(sample.gesture) ?? 0;
    if (count > dominantCount) {
      dominantCount = count;
      dominantGesture = sample.gesture;
    }
  }

  const peakConfidence = Math.max(...classified.map((sample) => sample.confidence));

  let gestureTransitions = 0;
  for (let i = 1; i < classified.length; i += 1) {
    if (classified[i].gesture !== classified[i - 1].gesture) gestureTransitions += 1;
  }

  const stability =
    classified.length < 2
      ? null
      : Math.max(0, Math.min(1, 1 - gestureTransitions / (classified.length - 1)));

  return { dominantGesture, gestureTransitions, peakConfidence, stability };
}
