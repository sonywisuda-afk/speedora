import {
  fusionContributionSchema,
  fusionInputSchema,
  fusionOutputSchema,
  fusionPredictionSchema,
  fusionRecommendationSchema,
  rankedClipSchema,
} from './fusion';

const FULL_LLM_SCORES = {
  hookStrength: 80,
  educationalValue: 70,
  practicalValue: 60,
  curiosity: 75,
  emotion: 50,
  storytelling: 65,
  novelty: 55,
  trustAuthority: 85,
  ctaStrength: 40,
};

describe('fusionInputSchema', () => {
  it('accepts all five signals present', () => {
    const result = fusionInputSchema.safeParse({
      clipId: 'clip-1',
      audio: {
        averageRmsDb: -18,
        peakDb: -3,
        averageSpeakingRateWordsPerSecond: 2.5,
        speakingRateStdDev: 0.3,
      },
      scene: { cutCount: 2, cutsPerMinute: 4, averageSegmentSeconds: 10 },
      facial: {
        dominantEmotion: 'happy',
        emotionTransitions: 1,
        peakConfidence: 0.9,
        stability: 0.8,
      },
      gesture: {
        dominantGesture: 'thumb_up',
        gestureTransitions: 0,
        peakConfidence: 0.85,
        stability: 1,
      },
      llm: FULL_LLM_SCORES,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a clip with no signals at all (every field optional)', () => {
    const result = fusionInputSchema.safeParse({ clipId: 'clip-1' });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed nested features object', () => {
    const result = fusionInputSchema.safeParse({
      clipId: 'clip-1',
      audio: { averageRmsDb: 'loud' },
    });
    expect(result.success).toBe(false);
  });
});

describe('fusionContributionSchema', () => {
  it('accepts a fully-populated contribution', () => {
    const result = fusionContributionSchema.safeParse({
      signal: 'audio',
      feature: 'averageRmsDb',
      rawValue: -15,
      normalizedValue: 0.83,
      weight: 0.35,
      weightedContribution: 29.05,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null rawValue for a category-derived feature', () => {
    const result = fusionContributionSchema.safeParse({
      signal: 'facial',
      feature: 'dominantEmotionWeight',
      rawValue: null,
      normalizedValue: 0.9,
      weight: 0.1,
      weightedContribution: 0.09,
    });
    expect(result.success).toBe(true);
  });
});

describe('fusionOutputSchema', () => {
  it('accepts a fully-scored output', () => {
    const result = fusionOutputSchema.safeParse({
      clipId: 'clip-1',
      highlightScore: 72,
      confidence: 0.8,
      contributions: [
        {
          signal: 'audio',
          feature: 'averageRmsDb',
          rawValue: -15,
          normalizedValue: 0.83,
          weight: 0.35,
          weightedContribution: 29.05,
        },
      ],
      explainability: {
        topFactors: [
          {
            signal: 'audio',
            feature: 'averageRmsDb',
            weightedContribution: 29.05,
            description: 'high vocal energy',
          },
        ],
      },
      reason: 'High vocal energy contributed most to this score.',
      prediction: { bucket: 'likely_high_performer', rationale: 'Score of 72 is above threshold.' },
      recommendation: { action: 'publish_as_is', message: 'Ready to publish.' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null highlightScore when no weighted signal was available', () => {
    const result = fusionOutputSchema.safeParse({
      clipId: 'clip-1',
      highlightScore: null,
      confidence: 0,
      contributions: [],
      explainability: { topFactors: [] },
      reason: 'No signals were available to score this clip.',
      prediction: { bucket: 'uncertain', rationale: 'No signals available.' },
      recommendation: { action: 'review_manually', message: 'Review this clip manually.' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a confidence outside the 0-1 range', () => {
    const result = fusionOutputSchema.safeParse({
      clipId: 'clip-1',
      highlightScore: 50,
      confidence: 1.5,
      contributions: [],
      explainability: { topFactors: [] },
      reason: 'x',
    });
    expect(result.success).toBe(false);
  });
});

describe('rankedClipSchema', () => {
  it('accepts a ranked clip', () => {
    const result = rankedClipSchema.safeParse({ clipId: 'clip-1', highlightScore: 80, rank: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts a null highlightScore ranked last', () => {
    const result = rankedClipSchema.safeParse({ clipId: 'clip-2', highlightScore: null, rank: 3 });
    expect(result.success).toBe(true);
  });
});

describe('fusionPredictionSchema', () => {
  it('accepts each of the three fixed buckets', () => {
    for (const bucket of ['likely_high_performer', 'uncertain', 'likely_low_performer']) {
      const result = fusionPredictionSchema.safeParse({ bucket, rationale: 'x' });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a bucket outside the fixed set', () => {
    const result = fusionPredictionSchema.safeParse({ bucket: 'definitely_viral', rationale: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('fusionRecommendationSchema', () => {
  it('accepts an action + message pair', () => {
    const result = fusionRecommendationSchema.safeParse({
      action: 'publish_as_is',
      message: 'Ready to publish.',
    });
    expect(result.success).toBe(true);
  });
});
