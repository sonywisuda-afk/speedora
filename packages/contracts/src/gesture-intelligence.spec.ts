import {
  detectGesturesInputSchema,
  detectGesturesOutputSchema,
  gestureFeaturesSchema,
  gestureSampleSchema,
  gestureSignalSchema,
} from './gesture-intelligence';

describe('gestureSampleSchema', () => {
  it('accepts a sample with a recognized gesture', () => {
    const result = gestureSampleSchema.safeParse({ t: 1.5, gesture: 'thumb_up', confidence: 0.88 });
    expect(result.success).toBe(true);
  });

  it('accepts a sample with a hand detected but no recognized gesture ("none")', () => {
    const result = gestureSampleSchema.safeParse({ t: 1.5, gesture: 'none', confidence: 0.6 });
    expect(result.success).toBe(true);
  });

  it('accepts a sample with no hand detected at all (null)', () => {
    const result = gestureSampleSchema.safeParse({ t: 1.5, gesture: null, confidence: null });
    expect(result.success).toBe(true);
  });

  it('rejects a gesture label outside the fixed taxonomy', () => {
    const result = gestureSampleSchema.safeParse({
      t: 1.5,
      gesture: 'peace_sign',
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('detectGesturesInputSchema', () => {
  it('accepts a valid input', () => {
    const result = detectGesturesInputSchema.safeParse({
      sourcePath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty sourcePath', () => {
    const result = detectGesturesInputSchema.safeParse({
      sourcePath: '',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(false);
  });
});

describe('detectGesturesOutputSchema', () => {
  it('accepts an empty array', () => {
    expect(detectGesturesOutputSchema.safeParse([]).success).toBe(true);
  });

  it('accepts a mix of recognized/none/null samples', () => {
    const result = detectGesturesOutputSchema.safeParse([
      { t: 0, gesture: 'thumb_up', confidence: 0.9 },
      { t: 1, gesture: 'none', confidence: 0.5 },
      { t: 2, gesture: null, confidence: null },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('gestureFeaturesSchema', () => {
  it('accepts a fully-populated features object', () => {
    const result = gestureFeaturesSchema.safeParse({
      dominantGesture: 'thumb_up',
      gestureTransitions: 1,
      peakConfidence: 0.9,
      stability: 0.7,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all-null/zero fields (no samples classified at all)', () => {
    const result = gestureFeaturesSchema.safeParse({
      dominantGesture: null,
      gestureTransitions: 0,
      peakConfidence: null,
      stability: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('gestureSignalSchema', () => {
  it('accepts a { raw, features } shape', () => {
    const result = gestureSignalSchema.safeParse({
      raw: [{ t: 0, gesture: 'thumb_up', confidence: 0.9 }],
      features: {
        dominantGesture: 'thumb_up',
        gestureTransitions: 0,
        peakConfidence: 0.9,
        stability: null,
      },
    });
    expect(result.success).toBe(true);
  });
});
