import { deriveGestureFeatures } from './derive-features';

describe('deriveGestureFeatures', () => {
  it('returns all-null/zero features when there are no samples at all', () => {
    expect(deriveGestureFeatures([])).toEqual({
      dominantGesture: null,
      gestureTransitions: 0,
      peakConfidence: null,
      stability: null,
    });
  });

  it('returns all-null/zero features when every sample failed to classify (no hand detected)', () => {
    const result = deriveGestureFeatures([
      { t: 0, gesture: null, confidence: null },
      { t: 1, gesture: null, confidence: null },
    ]);
    expect(result).toEqual({
      dominantGesture: null,
      gestureTransitions: 0,
      peakConfidence: null,
      stability: null,
    });
  });

  it('picks the most frequent gesture as dominant, breaking ties by first occurrence', () => {
    const result = deriveGestureFeatures([
      { t: 0, gesture: 'thumb_up', confidence: 0.8 },
      { t: 1, gesture: 'victory', confidence: 0.7 },
      { t: 2, gesture: 'thumb_up', confidence: 0.6 },
    ]);
    expect(result.dominantGesture).toBe('thumb_up');
  });

  it('computes peakConfidence as the max confidence across classified samples', () => {
    const result = deriveGestureFeatures([
      { t: 0, gesture: 'thumb_up', confidence: 0.6 },
      { t: 1, gesture: 'thumb_up', confidence: 0.95 },
      { t: 2, gesture: null, confidence: null },
    ]);
    expect(result.peakConfidence).toBe(0.95);
  });

  it('counts gestureTransitions only between consecutive CLASSIFIED samples, skipping nulls', () => {
    const result = deriveGestureFeatures([
      { t: 0, gesture: 'thumb_up', confidence: 0.8 },
      { t: 1, gesture: null, confidence: null },
      { t: 2, gesture: 'victory', confidence: 0.7 },
      { t: 3, gesture: 'victory', confidence: 0.6 },
    ]);
    expect(result.gestureTransitions).toBe(1);
  });

  it('returns stability 1 when every classified sample agrees', () => {
    const result = deriveGestureFeatures([
      { t: 0, gesture: 'none', confidence: 0.5 },
      { t: 1, gesture: 'none', confidence: 0.6 },
    ]);
    expect(result.stability).toBe(1);
  });

  it('returns null stability when fewer than 2 samples were classified', () => {
    const result = deriveGestureFeatures([{ t: 0, gesture: 'thumb_up', confidence: 0.9 }]);
    expect(result.stability).toBeNull();
  });
});
