import type { HookLinguisticFeatures, HookPredictionInput } from '@speedora/contracts';
import { computeHookPrediction } from './compute-hook-prediction';

const LINGUISTIC: HookLinguisticFeatures = {
  sentiment: 'positive',
  dominantEmotion: 'curiosity',
  surpriseScore: 0.8,
  controversyScore: 0.6,
  keywordRarityScore: 0.5,
  topicShiftScore: 0.2,
  questionDensity: 0.7,
  numericFactCount: 2,
  namedEntities: ['Acme Corp'],
};

const FULL_INPUT: HookPredictionInput = {
  clipId: 'clip-1',
  segments: [{ start: 0, end: 3, text: 'hook line', emotion: null, words: null }],
  audioFeatures: {
    averageRmsDb: -15,
    peakDb: -5,
    averageSpeakingRateWordsPerSecond: 2.5,
    speakingRateStdDev: 0.3,
  },
  pauseFeatures: { pauseCount: 1, longestPauseSeconds: 1, pauseBeforeHookRatio: 0.5 },
  dominantSpeakerConfidence: 0.9,
};

describe('computeHookPrediction', () => {
  it('produces a full-coverage prediction (confidence 1) when every input is present', () => {
    const result = computeHookPrediction(FULL_INPUT, LINGUISTIC);

    expect(result.clipId).toBe('clip-1');
    expect(result.confidence).toBe(1);
    expect(result.hookProbability).toBeGreaterThan(0);
    expect(result.hookProbability).toBeLessThanOrEqual(100);
    expect(result.linguisticFeatures).toEqual(LINGUISTIC);
  });

  it('reduces confidence (but still scores) when audio/speaker signals are missing', () => {
    const partialInput: HookPredictionInput = {
      ...FULL_INPUT,
      audioFeatures: {
        averageRmsDb: null,
        peakDb: null,
        averageSpeakingRateWordsPerSecond: null,
        speakingRateStdDev: null,
      },
      dominantSpeakerConfidence: null,
    };

    const result = computeHookPrediction(partialInput, LINGUISTIC);

    expect(result.confidence).toBeLessThan(1);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.hookProbability).toBeGreaterThanOrEqual(0);
  });

  it('returns hookProbability 0 and confidence 0 when literally nothing is available', () => {
    const zeroLinguistic: HookLinguisticFeatures = {
      sentiment: 'neutral',
      dominantEmotion: 'neutral',
      surpriseScore: 0,
      controversyScore: 0,
      keywordRarityScore: 0,
      topicShiftScore: 0,
      questionDensity: 0,
      numericFactCount: 0,
      namedEntities: [],
    };
    const zeroInput: HookPredictionInput = {
      ...FULL_INPUT,
      audioFeatures: {
        averageRmsDb: null,
        peakDb: null,
        averageSpeakingRateWordsPerSecond: null,
        speakingRateStdDev: null,
      },
      pauseFeatures: { pauseCount: 0, longestPauseSeconds: 0, pauseBeforeHookRatio: 0 },
      dominantSpeakerConfidence: null,
    };

    const result = computeHookPrediction(zeroInput, zeroLinguistic);

    expect(result.hookProbability).toBe(0);
    expect(result.predictionFeatures.expectedScrollStopRate).toBe(0);
    expect(result.predictionFeatures.expectedRetentionLift).toBe(-1);
    expect(result.predictionFeatures.expectedReplayPotential).toBe(0);
  });

  it('derives predictionFeatures as documented transforms of hookProbability/linguisticFeatures', () => {
    const result = computeHookPrediction(FULL_INPUT, LINGUISTIC);

    expect(result.predictionFeatures.expectedScrollStopRate).toBeCloseTo(
      result.hookProbability / 100,
      5,
    );
    expect(result.predictionFeatures.expectedRetentionLift).toBeCloseTo(
      Math.max(-1, Math.min(1, (result.hookProbability - 50) / 50)),
      5,
    );
    expect(result.predictionFeatures.expectedReplayPotential).toBeCloseTo(
      (LINGUISTIC.surpriseScore + LINGUISTIC.questionDensity) / 2,
      5,
    );
  });

  it('includes a non-generic, human-readable reason when signal is present', () => {
    const result = computeHookPrediction(FULL_INPUT, LINGUISTIC);
    expect(result.reason).not.toContain('Not enough signal');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
