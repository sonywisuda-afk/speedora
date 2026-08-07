import type { TranscriptWordInput } from '@speedora/contracts';
import { derivePauseFeatures } from './derive-pause-features';

function word(word: string, start: number, end: number): TranscriptWordInput {
  return { word, start, end };
}

describe('derivePauseFeatures', () => {
  it('returns all-zero features when there are no words', () => {
    expect(derivePauseFeatures([], 30)).toEqual({
      pauseCount: 0,
      longestPauseSeconds: 0,
      pauseBeforeHookRatio: 0,
    });
  });

  it('returns all-zero features when there is no gap long enough to count as a pause', () => {
    const words = [word('hi', 0, 0.3), word('there', 0.4, 0.8)];
    expect(derivePauseFeatures(words, 1)).toEqual({
      pauseCount: 0,
      longestPauseSeconds: 0,
      pauseBeforeHookRatio: 0,
    });
  });

  it('counts a long gap between words as a pause', () => {
    // A 2s gap between "hi" ending at 0.3 and "wow" starting at 2.3.
    const words = [word('hi', 0, 0.3), word('wow', 2.3, 2.6)];
    const result = derivePauseFeatures(words, 3);

    expect(result.pauseCount).toBe(1);
    // Gap is 2s, minus 2x0.15s edge padding = 1.7s.
    expect(result.longestPauseSeconds).toBeCloseTo(1.7, 2);
  });

  it('is 1.0 when the only pause is entirely inside the 5s hook window', () => {
    // Gap from 0.5s to 3.5s -> pause [0.65, 3.35], fully within the window.
    // clipDuration matches the last word's end so there's no trailing gap.
    const words = [word('a', 0, 0.5), word('b', 3.5, 4.0)];
    const result = derivePauseFeatures(words, 4.0);

    expect(result.pauseCount).toBe(1);
    expect(result.pauseBeforeHookRatio).toBeCloseTo(1, 2);
  });

  it('is 0.0 when the only pause is entirely after the 5s hook window', () => {
    // "a" spans right up to 5.2s, so the gap to "b" (starting at 9.0s) lands
    // entirely after the window. clipDuration matches the last word's end.
    const words = [word('a', 0, 5.2), word('b', 9.0, 9.5)];
    const result = derivePauseFeatures(words, 9.5);

    expect(result.pauseCount).toBe(1);
    expect(result.pauseBeforeHookRatio).toBeCloseTo(0, 2);
  });

  it('counts a long trailing gap after the last word as a pause', () => {
    const words = [word('hi', 0, 0.3)];
    const result = derivePauseFeatures(words, 3);

    expect(result.pauseCount).toBe(1);
  });
});
