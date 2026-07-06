import {
  detectSceneCutsInputSchema,
  detectSceneCutsOutputSchema,
  sceneFeaturesSchema,
  sceneSignalSchema,
} from './scene-intelligence';

describe('detectSceneCutsInputSchema', () => {
  it('accepts an input without a threshold (optional)', () => {
    const result = detectSceneCutsInputSchema.safeParse({
      videoPath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an input with an explicit threshold', () => {
    const result = detectSceneCutsInputSchema.safeParse({
      videoPath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
      threshold: 0.3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a threshold outside 0-1', () => {
    const result = detectSceneCutsInputSchema.safeParse({
      videoPath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
      threshold: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('detectSceneCutsOutputSchema', () => {
  it('accepts an empty cuts array', () => {
    expect(detectSceneCutsOutputSchema.safeParse({ cuts: [] }).success).toBe(true);
  });

  it('accepts a list of cut timestamps', () => {
    expect(detectSceneCutsOutputSchema.safeParse({ cuts: [1.2, 5.6] }).success).toBe(true);
  });
});

describe('sceneFeaturesSchema', () => {
  it('accepts a fully-populated features object', () => {
    const result = sceneFeaturesSchema.safeParse({
      cutCount: 3,
      cutsPerMinute: 6,
      averageSegmentSeconds: 10,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null cutsPerMinute/averageSegmentSeconds (zero-duration clip)', () => {
    const result = sceneFeaturesSchema.safeParse({
      cutCount: 0,
      cutsPerMinute: null,
      averageSegmentSeconds: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('sceneSignalSchema', () => {
  it('accepts a { raw, features } shape', () => {
    const result = sceneSignalSchema.safeParse({
      raw: [1.5, 4.2],
      features: { cutCount: 2, cutsPerMinute: 4, averageSegmentSeconds: 5 },
    });
    expect(result.success).toBe(true);
  });
});
