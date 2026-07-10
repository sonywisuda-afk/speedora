import {
  analyzeMotionEnergyInputSchema,
  analyzeMotionEnergyOutputSchema,
  cameraMotionFeaturesSchema,
  cameraMotionSampleSchema,
  classifySceneCutTypesInputSchema,
  classifySceneCutTypesOutputSchema,
  detectCameraMotionInputSchema,
  detectCameraMotionOutputSchema,
  detectSceneCutsInputSchema,
  detectSceneCutsOutputSchema,
  motionEnergyFeaturesSchema,
  motionEnergySampleSchema,
  sceneCutEventSchema,
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
      hardCutCount: 2,
      fadeCount: 1,
      dissolveCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null cutsPerMinute/averageSegmentSeconds (zero-duration clip)', () => {
    const result = sceneFeaturesSchema.safeParse({
      cutCount: 0,
      cutsPerMinute: null,
      averageSegmentSeconds: null,
      hardCutCount: 0,
      fadeCount: 0,
      dissolveCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a features object missing the Batch SC-1 cut-type breakdown', () => {
    const result = sceneFeaturesSchema.safeParse({
      cutCount: 3,
      cutsPerMinute: 6,
      averageSegmentSeconds: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe('sceneSignalSchema', () => {
  it('accepts a { raw, features } shape', () => {
    const result = sceneSignalSchema.safeParse({
      raw: [1.5, 4.2],
      features: {
        cutCount: 2,
        cutsPerMinute: 4,
        averageSegmentSeconds: 5,
        hardCutCount: 2,
        fadeCount: 0,
        dissolveCount: 0,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('sceneCutEventSchema', () => {
  it('accepts each cut type in the taxonomy', () => {
    for (const type of ['hard_cut', 'fade', 'dissolve'] as const) {
      expect(sceneCutEventSchema.safeParse({ t: 1.5, type }).success).toBe(true);
    }
  });

  it('rejects an unrecognized cut type', () => {
    expect(sceneCutEventSchema.safeParse({ t: 1.5, type: 'wipe' }).success).toBe(false);
  });
});

describe('classifySceneCutTypesInputSchema', () => {
  it('accepts a valid input with a cuts array', () => {
    const result = classifySceneCutTypesInputSchema.safeParse({
      videoPath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
      cuts: [12.5, 17.1],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty cuts array', () => {
    const result = classifySceneCutTypesInputSchema.safeParse({
      videoPath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
      cuts: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('classifySceneCutTypesOutputSchema', () => {
  it('accepts a list of classified cut events', () => {
    const result = classifySceneCutTypesOutputSchema.safeParse({
      events: [
        { t: 12.5, type: 'hard_cut' },
        { t: 17.1, type: 'fade' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('analyzeMotionEnergyInputSchema', () => {
  it('accepts a valid input', () => {
    const result = analyzeMotionEnergyInputSchema.safeParse({
      videoPath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(true);
  });
});

describe('motionEnergySampleSchema', () => {
  it('accepts a valid sample', () => {
    expect(motionEnergySampleSchema.safeParse({ t: 1.5, motionEnergy: 12.3 }).success).toBe(true);
  });

  it('rejects a negative motionEnergy', () => {
    expect(motionEnergySampleSchema.safeParse({ t: 1.5, motionEnergy: -1 }).success).toBe(false);
  });
});

describe('analyzeMotionEnergyOutputSchema', () => {
  it('accepts an empty samples array', () => {
    expect(analyzeMotionEnergyOutputSchema.safeParse({ samples: [] }).success).toBe(true);
  });

  it('accepts a list of motion energy samples', () => {
    const result = analyzeMotionEnergyOutputSchema.safeParse({
      samples: [
        { t: 0, motionEnergy: 0 },
        { t: 1, motionEnergy: 8.5 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('motionEnergyFeaturesSchema', () => {
  it('accepts a fully-populated features object', () => {
    const result = motionEnergyFeaturesSchema.safeParse({
      averageMotionEnergy: 5.2,
      peakMotionEnergy: 12.1,
      staticRatio: 0.6,
      dynamicRatio: 0.4,
      peakCount: 2,
      peakTimestamps: [3.5, 8.2],
      peakRatePerMinute: 1.5,
      motionVariability: 0.4,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all-null fields (no samples to derive from)', () => {
    const result = motionEnergyFeaturesSchema.safeParse({
      averageMotionEnergy: null,
      peakMotionEnergy: null,
      staticRatio: null,
      dynamicRatio: null,
      peakCount: null,
      peakTimestamps: null,
      peakRatePerMinute: null,
      motionVariability: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('detectCameraMotionInputSchema', () => {
  it('accepts a valid input', () => {
    const result = detectCameraMotionInputSchema.safeParse({
      sourcePath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty sourcePath', () => {
    const result = detectCameraMotionInputSchema.safeParse({
      sourcePath: '',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(false);
  });
});

describe('cameraMotionSampleSchema', () => {
  it('accepts a fully-populated sample', () => {
    const result = cameraMotionSampleSchema.safeParse({
      t: 1,
      dx: 0.02,
      dy: -0.01,
      scale: 1.05,
      rotation: 0.5,
      ecc: 0.92,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an all-null sample (no previous frame or failed alignment)', () => {
    const result = cameraMotionSampleSchema.safeParse({
      t: 0,
      dx: null,
      dy: null,
      scale: null,
      rotation: null,
      ecc: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('detectCameraMotionOutputSchema', () => {
  it('accepts an array of samples directly (not wrapped in an object)', () => {
    const result = detectCameraMotionOutputSchema.safeParse([
      { t: 0, dx: null, dy: null, scale: null, rotation: null, ecc: null },
      { t: 1, dx: 0.01, dy: 0, scale: 1, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('cameraMotionFeaturesSchema', () => {
  it('accepts a fully-populated features object', () => {
    const result = cameraMotionFeaturesSchema.safeParse({
      panScore: 0.5,
      tiltScore: 0.1,
      zoomScore: 0.2,
      shakeScore: 0.05,
      dominantMotionType: 'pan',
      dominantDirection: 'right',
      motionTypeDiversity: 0.8,
      smoothnessScore: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all-null fields (no classifiable samples)', () => {
    const result = cameraMotionFeaturesSchema.safeParse({
      panScore: null,
      tiltScore: null,
      zoomScore: null,
      shakeScore: null,
      dominantMotionType: null,
      dominantDirection: null,
      motionTypeDiversity: null,
      smoothnessScore: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized dominantMotionType', () => {
    const result = cameraMotionFeaturesSchema.safeParse({
      panScore: 0.5,
      tiltScore: 0.1,
      zoomScore: 0.2,
      shakeScore: 0.05,
      dominantMotionType: 'wobble',
      dominantDirection: 'right',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized dominantDirection', () => {
    const result = cameraMotionFeaturesSchema.safeParse({
      panScore: 0.5,
      tiltScore: 0.1,
      zoomScore: 0.2,
      shakeScore: 0.05,
      dominantMotionType: 'pan',
      dominantDirection: 'northeast',
    });
    expect(result.success).toBe(false);
  });
});
