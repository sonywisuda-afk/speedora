import { deriveSceneFeatures } from './derive-features';

describe('deriveSceneFeatures', () => {
  it('returns zero cutCount and the whole clip as one segment when there are no cuts', () => {
    const result = deriveSceneFeatures([], 30);
    expect(result).toEqual({ cutCount: 0, cutsPerMinute: 0, averageSegmentSeconds: 30 });
  });

  it('computes cutsPerMinute normalized to 60 seconds', () => {
    const result = deriveSceneFeatures([10, 20], 30);
    expect(result.cutCount).toBe(2);
    expect(result.cutsPerMinute).toBe(4);
  });

  it('computes averageSegmentSeconds as duration divided by (cutCount + 1)', () => {
    const result = deriveSceneFeatures([10, 20], 30);
    expect(result.averageSegmentSeconds).toBe(10);
  });

  it('returns null cutsPerMinute/averageSegmentSeconds for a zero-duration clip', () => {
    const result = deriveSceneFeatures([1, 2], 0);
    expect(result).toEqual({ cutCount: 2, cutsPerMinute: null, averageSegmentSeconds: null });
  });
});
