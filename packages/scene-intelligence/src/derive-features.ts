import type { SceneFeatures } from '@speedora/contracts';

// Pure, synchronous summary derivation over detectSceneCuts()'s raw `cuts`
// array - a separate function from the subprocess-calling one, same reason
// as @speedora/facial-intelligence's deriveFacialEmotionFeatures(). See
// packages/contracts/src/intelligence-signal.ts.
export function deriveSceneFeatures(cuts: number[], clipDurationSeconds: number): SceneFeatures {
  const cutCount = cuts.length;

  if (clipDurationSeconds <= 0) {
    return { cutCount, cutsPerMinute: null, averageSegmentSeconds: null };
  }

  const cutsPerMinute = (cutCount / clipDurationSeconds) * 60;
  // The cuts (wherever they fall) divide the clip into cutCount + 1
  // segments whose lengths always sum to the full clip duration - no need
  // to sort/walk the individual cut positions to get the mean.
  const averageSegmentSeconds = clipDurationSeconds / (cutCount + 1);

  return { cutCount, cutsPerMinute, averageSegmentSeconds };
}
