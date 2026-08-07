import type { HookPredictionSegment } from '@speedora/contracts';
import type OpenAI from 'openai';
import { extractLinguisticFeatures } from './extract-linguistic-features';

function fakeOpenAI(content: Record<string, unknown>): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const RAW: Record<string, unknown> = {
  sentiment: 'positive',
  dominantEmotion: 'curiosity',
  surpriseScore: 0.7,
  controversyScore: 0.2,
  keywordRarityScore: 0.5,
  topicShiftScore: 0.1,
  questionDensity: 0.4,
  numericFactCount: 2,
  namedEntities: ['Acme Corp'],
};

const SEGMENTS: HookPredictionSegment[] = [
  {
    start: 0,
    end: 3,
    text: 'Did you know Acme Corp made $500 million?',
    emotion: null,
    words: null,
  },
];

describe('extractLinguisticFeatures', () => {
  it('parses a well-formed LLM response into HookLinguisticFeatures', async () => {
    const openai = fakeOpenAI(RAW);

    const result = await extractLinguisticFeatures(SEGMENTS, { openai });

    expect(result).toEqual(RAW);
  });

  it('clamps out-of-range scores to 0-1 and numericFactCount to a non-negative integer', async () => {
    const openai = fakeOpenAI({
      ...RAW,
      surpriseScore: 5,
      controversyScore: -2,
      questionDensity: 1.5,
      numericFactCount: -3.7,
    });

    const result = await extractLinguisticFeatures(SEGMENTS, { openai });

    expect(result.surpriseScore).toBe(1);
    expect(result.controversyScore).toBe(0);
    expect(result.questionDensity).toBe(1);
    expect(result.numericFactCount).toBe(0);
  });

  it('sends the transcript text and a strict json_schema response format', async () => {
    const openai = fakeOpenAI(RAW);

    await extractLinguisticFeatures(SEGMENTS, { openai });

    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(call.model).toBe('gpt-4o-mini');
    expect(call.response_format.type).toBe('json_schema');
    expect(call.response_format.json_schema.strict).toBe(true);
    expect(call.messages[1].content).toContain('$500 million');
  });
});
