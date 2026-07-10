import {
  detectObjectsInputSchema,
  detectObjectsOutputSchema,
  detectObjectsTracksOutputSchema,
  objectFeaturesSchema,
} from './object-intelligence';

describe('detectObjectsInputSchema', () => {
  it('accepts a valid input', () => {
    const result = detectObjectsInputSchema.safeParse({
      sourcePath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty sourcePath', () => {
    const result = detectObjectsInputSchema.safeParse({
      sourcePath: '',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(false);
  });
});

describe('detectObjectsOutputSchema', () => {
  it('accepts an empty objects array for a sample (no detections is a real result)', () => {
    const result = detectObjectsOutputSchema.safeParse([{ t: 0, objects: [] }]);
    expect(result.success).toBe(true);
  });

  it('accepts multiple simultaneous objects within one sample', () => {
    const result = detectObjectsOutputSchema.safeParse([
      {
        t: 0,
        objects: [
          {
            category: 'person',
            boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
            confidence: 0.9,
          },
          {
            category: 'car',
            boundingBox: { xCenter: 0.7, yCenter: 0.5, width: 0.3, height: 0.2 },
            confidence: 0.75,
          },
        ],
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects a confidence outside [0, 1]', () => {
    const result = detectObjectsOutputSchema.safeParse([
      {
        t: 0,
        objects: [
          {
            category: 'person',
            boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
            confidence: 1.5,
          },
        ],
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects an empty category string', () => {
    const result = detectObjectsOutputSchema.safeParse([
      {
        t: 0,
        objects: [
          {
            category: '',
            boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
            confidence: 0.9,
          },
        ],
      },
    ]);
    expect(result.success).toBe(false);
  });
});

describe('detectObjectsTracksOutputSchema', () => {
  it('accepts a fully-populated track', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 5,
        durationSeconds: 5,
        appearsFrames: 5,
        persistenceScore: 0.5,
        motionSpeed: 0.6,
        motionDirection: 'right',
        occlusionScore: 0.2,
        interactionConfidence: 0.3,
        attentionScore: 0.5,
        attentionConfidence: 0.6,
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts a single-appearance track with null motionSpeed/motionDirection', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 0,
        durationSeconds: 0,
        appearsFrames: 1,
        persistenceScore: 0.1,
        motionSpeed: null,
        motionDirection: null,
        occlusionScore: 0,
        interactionConfidence: 0,
        attentionScore: 0.5,
        attentionConfidence: 0.2,
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects appearsFrames below 1', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 5,
        durationSeconds: 5,
        appearsFrames: 0,
        persistenceScore: 0.5,
        motionSpeed: null,
        motionDirection: null,
        occlusionScore: 0,
        interactionConfidence: 0,
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized motionDirection', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 5,
        durationSeconds: 5,
        appearsFrames: 5,
        persistenceScore: 0.5,
        motionSpeed: 0.6,
        motionDirection: 'northeast',
        occlusionScore: 0.2,
        interactionConfidence: 0.3,
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects an occlusionScore outside [0, 1]', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 5,
        durationSeconds: 5,
        appearsFrames: 5,
        persistenceScore: 0.5,
        motionSpeed: 0.6,
        motionDirection: 'right',
        occlusionScore: 1.5,
        interactionConfidence: 0.3,
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects an interactionConfidence outside [0, 1]', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 5,
        durationSeconds: 5,
        appearsFrames: 5,
        persistenceScore: 0.5,
        motionSpeed: 0.6,
        motionDirection: 'right',
        occlusionScore: 0.2,
        interactionConfidence: -0.1,
        attentionScore: 0.5,
        attentionConfidence: 0.6,
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects an attentionScore outside [0, 1]', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 5,
        durationSeconds: 5,
        appearsFrames: 5,
        persistenceScore: 0.5,
        motionSpeed: 0.6,
        motionDirection: 'right',
        occlusionScore: 0.2,
        interactionConfidence: 0.3,
        attentionScore: 1.1,
        attentionConfidence: 0.6,
      },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects an attentionConfidence outside [0, 1]', () => {
    const result = detectObjectsTracksOutputSchema.safeParse([
      {
        trackId: 0,
        category: 'person',
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
        confidence: 0.9,
        startTime: 0,
        endTime: 5,
        durationSeconds: 5,
        appearsFrames: 5,
        persistenceScore: 0.5,
        motionSpeed: 0.6,
        motionDirection: 'right',
        occlusionScore: 0.2,
        interactionConfidence: 0.3,
        attentionScore: 0.5,
        attentionConfidence: -0.1,
      },
    ]);
    expect(result.success).toBe(false);
  });
});

describe('objectFeaturesSchema', () => {
  it('accepts a fully-populated features object', () => {
    const result = objectFeaturesSchema.safeParse({
      objectCount: 3,
      dominantObject: 'person',
      averageObjectsPerFrame: 1.5,
      averageTrackingConfidence: 0.85,
      averagePersistence: 0.4,
      averageMotionSpeed: 0.5,
      averageOcclusionScore: 0.1,
      averageInteractionConfidence: 0.2,
      averageAttentionScore: 0.5,
      averageAttentionConfidence: 0.6,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all-null fields (no samples to derive from)', () => {
    const result = objectFeaturesSchema.safeParse({
      objectCount: null,
      dominantObject: null,
      averageObjectsPerFrame: null,
      averageTrackingConfidence: null,
      averagePersistence: null,
      averageMotionSpeed: null,
      averageOcclusionScore: null,
      averageInteractionConfidence: null,
      averageAttentionScore: null,
      averageAttentionConfidence: null,
    });
    expect(result.success).toBe(true);
  });
});
