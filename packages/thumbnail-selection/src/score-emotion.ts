import type { FacialEmotionSample } from '@speedora/contracts';

// A small positive-emotion allowlist - narrower than @speedora/contracts'
// AFFECT_LABELS, purpose-built for "does this instant look good as a
// thumbnail" rather than a general engagement proxy. Every other emotion
// (including 'neutral' and null) is simply absent from the returned map,
// not penalized - a neutral/undetected face isn't a bad thumbnail moment,
// just not a specifically GOOD one by this signal's own read.
const POSITIVE_EMOTIONS = new Set(['happy', 'surprise']);

export function scoreEmotion(samples: FacialEmotionSample[] | null): Map<number, number> {
  const scores = new Map<number, number>();
  for (const sample of samples ?? []) {
    if (sample.emotion === null || sample.score === null) continue;
    if (!POSITIVE_EMOTIONS.has(sample.emotion)) continue;
    scores.set(sample.t, sample.score);
  }
  return scores;
}
