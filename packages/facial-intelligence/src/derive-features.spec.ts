import { deriveFacialEmotionFeatures } from './derive-features';

describe('deriveFacialEmotionFeatures', () => {
  it('returns all-null/zero features when there are no samples at all', () => {
    expect(deriveFacialEmotionFeatures([])).toEqual({
      dominantEmotion: null,
      emotionTransitions: 0,
      peakConfidence: null,
      stability: null,
    });
  });

  it('returns all-null/zero features when every sample failed to classify', () => {
    const result = deriveFacialEmotionFeatures([
      { t: 0, emotion: null, score: null },
      { t: 1, emotion: null, score: null },
    ]);
    expect(result).toEqual({
      dominantEmotion: null,
      emotionTransitions: 0,
      peakConfidence: null,
      stability: null,
    });
  });

  it('picks the most frequent emotion as dominant, breaking ties by first occurrence', () => {
    const result = deriveFacialEmotionFeatures([
      { t: 0, emotion: 'happy', score: 0.8 },
      { t: 1, emotion: 'sad', score: 0.7 },
      { t: 2, emotion: 'happy', score: 0.6 },
    ]);
    expect(result.dominantEmotion).toBe('happy');
  });

  it('computes peakConfidence as the max score across classified samples', () => {
    const result = deriveFacialEmotionFeatures([
      { t: 0, emotion: 'happy', score: 0.6 },
      { t: 1, emotion: 'happy', score: 0.95 },
      { t: 2, emotion: null, score: null },
    ]);
    expect(result.peakConfidence).toBe(0.95);
  });

  it('counts emotionTransitions only between consecutive CLASSIFIED samples, skipping nulls', () => {
    const result = deriveFacialEmotionFeatures([
      { t: 0, emotion: 'happy', score: 0.8 },
      { t: 1, emotion: null, score: null },
      { t: 2, emotion: 'sad', score: 0.7 },
      { t: 3, emotion: 'sad', score: 0.6 },
    ]);
    // classified sequence is happy -> sad -> sad: exactly 1 transition.
    expect(result.emotionTransitions).toBe(1);
  });

  it('returns stability 1 when every classified sample agrees', () => {
    const result = deriveFacialEmotionFeatures([
      { t: 0, emotion: 'neutral', score: 0.5 },
      { t: 1, emotion: 'neutral', score: 0.6 },
      { t: 2, emotion: 'neutral', score: 0.7 },
    ]);
    expect(result.stability).toBe(1);
  });

  it('returns stability 0 when every classified sample differs from the last', () => {
    const result = deriveFacialEmotionFeatures([
      { t: 0, emotion: 'happy', score: 0.5 },
      { t: 1, emotion: 'sad', score: 0.5 },
      { t: 2, emotion: 'angry', score: 0.5 },
    ]);
    expect(result.stability).toBe(0);
  });

  it('returns null stability when fewer than 2 samples were classified', () => {
    const result = deriveFacialEmotionFeatures([{ t: 0, emotion: 'happy', score: 0.9 }]);
    expect(result.stability).toBeNull();
  });
});
