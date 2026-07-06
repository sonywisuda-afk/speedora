import { extractFeatures, normalizeFeatures, weightFeatures } from './feature-pipeline';

describe('extractFeatures', () => {
  it('returns an empty array when no signal is present', () => {
    expect(extractFeatures({ clipId: 'clip-1' })).toEqual([]);
  });

  it('extracts averageRmsDb and speakingRateStdDev for audio, skipping null readings', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      audio: {
        averageRmsDb: -15,
        peakDb: -2,
        averageSpeakingRateWordsPerSecond: 2,
        speakingRateStdDev: null,
      },
    });
    expect(result).toEqual([
      { signal: 'audio', feature: 'averageRmsDb', value: -15, isCategoryDerived: false },
    ]);
  });

  it('extracts cutsPerMinute for scene, and nothing when cutsPerMinute is null', () => {
    const present = extractFeatures({
      clipId: 'clip-1',
      scene: { cutCount: 2, cutsPerMinute: 12, averageSegmentSeconds: 5 },
    });
    expect(present).toEqual([
      { signal: 'scene', feature: 'cutsPerMinute', value: 12, isCategoryDerived: false },
    ]);

    const absent = extractFeatures({
      clipId: 'clip-1',
      scene: { cutCount: 0, cutsPerMinute: null, averageSegmentSeconds: null },
    });
    expect(absent).toEqual([]);
  });

  it('extracts dominantEmotionWeight (category-derived, with label), peakConfidence, and stability for facial', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      facial: {
        dominantEmotion: 'happy',
        emotionTransitions: 0,
        peakConfidence: 0.9,
        stability: 0.8,
      },
    });
    expect(result).toEqual([
      {
        signal: 'facial',
        feature: 'dominantEmotionWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'happy',
      },
      { signal: 'facial', feature: 'peakConfidence', value: 0.9, isCategoryDerived: false },
      { signal: 'facial', feature: 'stability', value: 0.8, isCategoryDerived: false },
    ]);
  });

  it('extracts dominantGestureWeight (category-derived, with label) for gesture', () => {
    const result = extractFeatures({
      clipId: 'clip-1',
      gesture: {
        dominantGesture: 'thumb_up',
        gestureTransitions: 0,
        peakConfidence: 0.9,
        stability: null,
      },
    });
    expect(result).toEqual([
      {
        signal: 'gesture',
        feature: 'dominantGestureWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'thumb_up',
      },
      { signal: 'gesture', feature: 'peakConfidence', value: 0.9, isCategoryDerived: false },
    ]);
  });
});

describe('normalizeFeatures', () => {
  it('maps averageRmsDb from [-40,-10] dB to [0,1]', () => {
    const result = normalizeFeatures([
      { signal: 'audio', feature: 'averageRmsDb', value: -10, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBe(1);
  });

  it('maps cutsPerMinute to a [0.2, 1] range (non-zero baseline for zero cuts)', () => {
    const result = normalizeFeatures([
      { signal: 'scene', feature: 'cutsPerMinute', value: 0, isCategoryDerived: false },
    ]);
    expect(result[0].normalizedValue).toBeCloseTo(0.2);
  });

  it('divides a 0-100 category weight down to 0-1', () => {
    const result = normalizeFeatures([
      {
        signal: 'facial',
        feature: 'dominantEmotionWeight',
        value: 90,
        isCategoryDerived: true,
        label: 'happy',
      },
    ]);
    expect(result[0].normalizedValue).toBeCloseTo(0.9);
  });

  it('throws for an unregistered feature name', () => {
    expect(() =>
      normalizeFeatures([
        { signal: 'audio', feature: 'unknownFeature', value: 1, isCategoryDerived: false },
      ]),
    ).toThrow();
  });
});

describe('weightFeatures', () => {
  it('splits a signal weight evenly across however many of its own features are present', () => {
    const result = weightFeatures(
      [
        {
          signal: 'facial',
          feature: 'dominantEmotionWeight',
          value: 90,
          normalizedValue: 0.9,
          isCategoryDerived: true,
          label: 'happy',
        },
        {
          signal: 'facial',
          feature: 'peakConfidence',
          value: 0.9,
          normalizedValue: 0.9,
          isCategoryDerived: false,
        },
      ],
      { facial: 0.2 },
    );
    expect(result[0].weight).toBeCloseTo(0.1);
    expect(result[1].weight).toBeCloseTo(0.1);
  });

  it('assigns weight 0 to a signal missing from the weight table', () => {
    const result = weightFeatures(
      [
        {
          signal: 'gesture',
          feature: 'peakConfidence',
          value: 0.9,
          normalizedValue: 0.9,
          isCategoryDerived: false,
        },
      ],
      { audio: 0.35 },
    );
    expect(result[0].weight).toBe(0);
    expect(result[0].weightedContribution).toBe(0);
  });
});
