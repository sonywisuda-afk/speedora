import type {
  FacialEmotion,
  FacialEmotionFeatures,
  FacialEmotionSample,
} from '@speedora/contracts';

type ClassifiedSample = { t: number; emotion: FacialEmotion; score: number };

// Pure, synchronous summary derivation over detectFacialEmotion()'s raw
// per-sample output - deliberately a SEPARATE function (not folded into
// detectFacialEmotion itself) so the subprocess-calling function's already-
// tested signature doesn't change. See packages/contracts/src/
// intelligence-signal.ts for why this raw/features split exists: the
// adapter calls both and persists `{ raw, features }`.
export function deriveFacialEmotionFeatures(samples: FacialEmotionSample[]): FacialEmotionFeatures {
  const classified = samples.filter(
    (sample): sample is ClassifiedSample => sample.emotion !== null && sample.score !== null,
  );

  if (classified.length === 0) {
    return { dominantEmotion: null, emotionTransitions: 0, peakConfidence: null, stability: null };
  }

  const counts = new Map<string, number>();
  for (const sample of classified) {
    counts.set(sample.emotion, (counts.get(sample.emotion) ?? 0) + 1);
  }

  // First-occurrence tie-break: scanning in original order and only
  // updating on a STRICTLY greater count means the first emotion to reach
  // the eventual maximum wins ties, never a later one with the same count.
  let dominantEmotion = classified[0].emotion;
  let dominantCount = 0;
  for (const sample of classified) {
    const count = counts.get(sample.emotion) ?? 0;
    if (count > dominantCount) {
      dominantCount = count;
      dominantEmotion = sample.emotion;
    }
  }

  const peakConfidence = Math.max(...classified.map((sample) => sample.score));

  let emotionTransitions = 0;
  for (let i = 1; i < classified.length; i += 1) {
    if (classified[i].emotion !== classified[i - 1].emotion) emotionTransitions += 1;
  }

  const stability =
    classified.length < 2
      ? null
      : Math.max(0, Math.min(1, 1 - emotionTransitions / (classified.length - 1)));

  return { dominantEmotion, emotionTransitions, peakConfidence, stability };
}
