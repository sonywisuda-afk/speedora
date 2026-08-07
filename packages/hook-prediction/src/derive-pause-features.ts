import { computeSilenceCuts } from '@speedora/cutlist';
import type { HookPauseFeatures, TranscriptWordInput } from '@speedora/contracts';

// How much of the clip's opening counts as "the hook" for
// pauseBeforeHookRatio's purposes - long enough to cover a typical spoken
// hook line, short enough that a pause landing past it reads as ordinary
// mid-clip pacing rather than a deliberate pre-hook beat. Not derived from
// any real engagement data (ADR D4).
const HOOK_WINDOW_SECONDS = 5;

// Reuses @speedora/cutlist's silence-gap detection (ADR D5) rather than
// re-implementing gap math - cutlist only cares whether a gap is
// cut-worthy for trimming, so this module's own job is just scoring what
// that same gap data means for a HOOK specifically. `words` must already be
// clip-relative (0 = clip start), same convention as cutlist itself.
export function derivePauseFeatures(
  words: TranscriptWordInput[],
  clipDurationSeconds: number,
): HookPauseFeatures {
  const cuts = computeSilenceCuts(words, clipDurationSeconds);

  if (cuts.length === 0) {
    return { pauseCount: 0, longestPauseSeconds: 0, pauseBeforeHookRatio: 0 };
  }

  const longestPauseSeconds = Math.max(...cuts.map((cut) => cut.end - cut.start));
  const totalPauseSeconds = cuts.reduce((sum, cut) => sum + (cut.end - cut.start), 0);
  const preHookPauseSeconds = cuts.reduce((sum, cut) => {
    const overlapEnd = Math.min(cut.end, HOOK_WINDOW_SECONDS);
    const overlapStart = Math.min(cut.start, HOOK_WINDOW_SECONDS);
    return sum + Math.max(0, overlapEnd - overlapStart);
  }, 0);

  return {
    pauseCount: cuts.length,
    longestPauseSeconds,
    pauseBeforeHookRatio: totalPauseSeconds > 0 ? preHookPauseSeconds / totalPauseSeconds : 0,
  };
}
