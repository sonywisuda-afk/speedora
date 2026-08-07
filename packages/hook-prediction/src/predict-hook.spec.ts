import type { HookPredictionInput } from '@speedora/contracts';
import type OpenAI from 'openai';
import { predictHook } from './predict-hook';

function fakeOpenAI(content: Record<string, unknown>): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const RAW_LINGUISTIC = {
  sentiment: 'positive',
  dominantEmotion: 'curiosity',
  surpriseScore: 0.7,
  controversyScore: 0.3,
  keywordRarityScore: 0.4,
  topicShiftScore: 0.1,
  questionDensity: 0.6,
  numericFactCount: 1,
  namedEntities: [],
};

const INPUT: HookPredictionInput = {
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

describe('predictHook', () => {
  it('orchestrates the LLM call and the pure scoring step into one HookPredictionOutput', async () => {
    const openai = fakeOpenAI(RAW_LINGUISTIC);

    const result = await predictHook(INPUT, { openai });

    expect(result.clipId).toBe('clip-1');
    expect(result.linguisticFeatures).toEqual(RAW_LINGUISTIC);
    expect(result.hookProbability).toBeGreaterThan(0);
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});
