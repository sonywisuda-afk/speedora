import type { SelectThumbnailTimestampInput } from '@speedora/contracts';
import { selectThumbnailTimestamp } from './select-thumbnail-timestamp';

function baseInput(
  overrides: Partial<SelectThumbnailTimestampInput> = {},
): SelectThumbnailTimestampInput {
  return {
    clipDurationSeconds: 10,
    faceLandmarks: null,
    facialEmotions: null,
    ocrTracks: null,
    gestures: null,
    motionEnergy: null,
    sceneCutEvents: null,
    primarySubjectSamples: null,
    ...overrides,
  };
}

describe('selectThumbnailTimestamp', () => {
  it('falls back to the clip midpoint when zero signals have any data', () => {
    const result = selectThumbnailTimestamp(baseInput());
    expect(result.fallbackLevel).toBe('midpoint');
    expect(result.timestampSeconds).toBe(5);
    expect(result.confidence).toBe(0);
    expect(result.contributions).toEqual([]);
  });

  it('uses the single signal outright when only one has data', () => {
    const result = selectThumbnailTimestamp(
      baseInput({
        facialEmotions: [
          { t: 1, emotion: 'happy', score: 0.5 },
          { t: 2, emotion: 'happy', score: 0.9 },
        ],
      }),
    );
    expect(result.fallbackLevel).toBe('single_signal');
    expect(result.timestampSeconds).toBe(2);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0].signal).toBe('emotion');
  });

  it('combines multiple signals via weighted sum and picks the best candidate', () => {
    const result = selectThumbnailTimestamp(
      baseInput({
        facialEmotions: [
          { t: 1, emotion: 'happy', score: 1 },
          { t: 2, emotion: 'happy', score: 0.1 },
        ],
        gestures: [{ t: 2, gesture: 'thumb_up', confidence: 1 }],
      }),
    );
    expect(result.fallbackLevel).toBe('multi_signal');
    // emotion weight 0.25 * 1 = 0.25 at t=1 vs emotion 0.25*0.1 + gesture 0.05*1 = 0.075 at t=2.
    expect(result.timestampSeconds).toBe(1);
    expect(result.contributions.length).toBeGreaterThanOrEqual(1);
  });

  it('breaks ties by the earliest timestamp', () => {
    const result = selectThumbnailTimestamp(
      baseInput({
        facialEmotions: [
          { t: 3, emotion: 'happy', score: 0.5 },
          { t: 1, emotion: 'happy', score: 0.5 },
        ],
      }),
    );
    expect(result.timestampSeconds).toBe(1);
  });

  it('respects injected weights over the defaults', () => {
    const input = baseInput({
      facialEmotions: [{ t: 1, emotion: 'happy', score: 1 }],
      gestures: [{ t: 2, gesture: 'thumb_up', confidence: 1 }],
    });
    const result = selectThumbnailTimestamp(input, { emotion: 0, gesture: 1 });
    expect(result.timestampSeconds).toBe(2);
  });

  it('confidence reflects the fraction of weighted signals with any data', () => {
    const result = selectThumbnailTimestamp(
      baseInput({
        facialEmotions: [{ t: 1, emotion: 'happy', score: 1 }],
      }),
    );
    // Only 1 of the 6 default-weighted signals has data.
    expect(result.confidence).toBeCloseTo(1 / 6);
  });
});
