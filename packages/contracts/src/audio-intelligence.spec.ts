import {
  analyzeAudioLoudnessInputSchema,
  audioFeaturesSchema,
  audioSegmentSampleSchema,
  audioSignalSchema,
  loudnessMeasurementSchema,
  speakingRateInputSchema,
  speakingRateOutputSchema,
} from './audio-intelligence';

describe('analyzeAudioLoudnessInputSchema', () => {
  it('accepts a path with a list of segment ranges', () => {
    const result = analyzeAudioLoudnessInputSchema.safeParse({
      audioPath: '/tmp/audio.mp3',
      segments: [{ start: 0, end: 5 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing audioPath', () => {
    expect(analyzeAudioLoudnessInputSchema.safeParse({ segments: [] }).success).toBe(false);
  });
});

describe('loudnessMeasurementSchema', () => {
  it('accepts null readings', () => {
    expect(loudnessMeasurementSchema.safeParse({ rmsDb: null, peakDb: null }).success).toBe(true);
  });

  it('accepts numeric readings', () => {
    expect(loudnessMeasurementSchema.safeParse({ rmsDb: -20.5, peakDb: -3.1 }).success).toBe(true);
  });
});

describe('speakingRateInputSchema/OutputSchema', () => {
  it('accepts a valid input', () => {
    const result = speakingRateInputSchema.safeParse({
      segmentStart: 0,
      segmentEnd: 5,
      wordCount: 10,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid output', () => {
    expect(speakingRateOutputSchema.safeParse({ wordsPerSecond: 2.5 }).success).toBe(true);
  });
});

describe('audioSegmentSampleSchema', () => {
  it('accepts all-null readings', () => {
    const result = audioSegmentSampleSchema.safeParse({
      rmsDb: null,
      peakDb: null,
      speakingRateWordsPerSecond: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts numeric readings', () => {
    const result = audioSegmentSampleSchema.safeParse({
      rmsDb: -18,
      peakDb: -3,
      speakingRateWordsPerSecond: 2.1,
    });
    expect(result.success).toBe(true);
  });
});

describe('audioFeaturesSchema', () => {
  it('accepts a fully-populated features object', () => {
    const result = audioFeaturesSchema.safeParse({
      averageRmsDb: -18,
      peakDb: -3,
      averageSpeakingRateWordsPerSecond: 2.1,
      speakingRateStdDev: 0.4,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all-null fields (zero segments with a reading)', () => {
    const result = audioFeaturesSchema.safeParse({
      averageRmsDb: null,
      peakDb: null,
      averageSpeakingRateWordsPerSecond: null,
      speakingRateStdDev: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('audioSignalSchema', () => {
  it('accepts a { raw, features } shape', () => {
    const result = audioSignalSchema.safeParse({
      raw: [{ rmsDb: -18, peakDb: -3, speakingRateWordsPerSecond: 2.1 }],
      features: {
        averageRmsDb: -18,
        peakDb: -3,
        averageSpeakingRateWordsPerSecond: 2.1,
        speakingRateStdDev: null,
      },
    });
    expect(result.success).toBe(true);
  });
});
