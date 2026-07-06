import {
  detectFacialEmotionInputSchema,
  detectFacialEmotionOutputSchema,
  facialEmotionFeaturesSchema,
  facialEmotionSampleSchema,
  facialEmotionSignalSchema,
} from './facial-intelligence';

describe('facialEmotionSampleSchema', () => {
  it('accepts a sample with a classified emotion', () => {
    const result = facialEmotionSampleSchema.safeParse({ t: 1.5, emotion: 'happy', score: 0.87 });
    expect(result.success).toBe(true);
  });

  it('accepts a sample with no face found (null emotion and score)', () => {
    const result = facialEmotionSampleSchema.safeParse({ t: 1.5, emotion: null, score: null });
    expect(result.success).toBe(true);
  });

  it('rejects an emotion label outside the fixed 7-class taxonomy', () => {
    const result = facialEmotionSampleSchema.safeParse({ t: 1.5, emotion: 'bored', score: 0.5 });
    expect(result.success).toBe(false);
  });

  it('rejects a score outside the 0-1 range', () => {
    const result = facialEmotionSampleSchema.safeParse({ t: 1.5, emotion: 'happy', score: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe('detectFacialEmotionInputSchema', () => {
  it('accepts a valid input', () => {
    const result = detectFacialEmotionInputSchema.safeParse({
      sourcePath: '/tmp/source.mp4',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty sourcePath', () => {
    const result = detectFacialEmotionInputSchema.safeParse({
      sourcePath: '',
      startTime: 10,
      endTime: 20,
    });
    expect(result.success).toBe(false);
  });
});

describe('detectFacialEmotionOutputSchema', () => {
  it('accepts an empty array', () => {
    expect(detectFacialEmotionOutputSchema.safeParse([]).success).toBe(true);
  });

  it('accepts a mix of classified and non-classified samples', () => {
    const result = detectFacialEmotionOutputSchema.safeParse([
      { t: 0, emotion: 'neutral', score: 0.6 },
      { t: 1, emotion: null, score: null },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('facialEmotionFeaturesSchema', () => {
  it('accepts a fully-populated features object', () => {
    const result = facialEmotionFeaturesSchema.safeParse({
      dominantEmotion: 'happy',
      emotionTransitions: 2,
      peakConfidence: 0.95,
      stability: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all-null fields (zero classified samples)', () => {
    const result = facialEmotionFeaturesSchema.safeParse({
      dominantEmotion: null,
      emotionTransitions: 0,
      peakConfidence: null,
      stability: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a dominantEmotion outside the fixed taxonomy', () => {
    const result = facialEmotionFeaturesSchema.safeParse({
      dominantEmotion: 'bored',
      emotionTransitions: 0,
      peakConfidence: null,
      stability: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('facialEmotionSignalSchema', () => {
  it('accepts a { raw, features } shape', () => {
    const result = facialEmotionSignalSchema.safeParse({
      raw: [{ t: 0, emotion: 'happy', score: 0.9 }],
      features: {
        dominantEmotion: 'happy',
        emotionTransitions: 0,
        peakConfidence: 0.9,
        stability: null,
      },
    });
    expect(result.success).toBe(true);
  });
});
