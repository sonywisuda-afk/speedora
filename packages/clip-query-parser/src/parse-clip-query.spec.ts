import type OpenAI from 'openai';
import { parseClipQuery } from './parse-clip-query';

// Pure fixture-based tests - no DB/queue/Sentry mocking, same posture as
// @speedora/subtitle-translate's own spec (this module never touches any
// of that). Only the LLM call itself is faked, via the injected deps.openai.
function fakeOpenAI(rawResult: Record<string, unknown>): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(rawResult) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const NULL_RESULT = {
  minScore: null,
  platform: null,
  minDuration: null,
  maxDuration: null,
  topics: null,
  emotion: null,
  keyword: null,
  summary: 'No filters applied.',
};

describe('parseClipQuery', () => {
  it('sends the query and availableTopics in one call', async () => {
    const openai = fakeOpenAI(NULL_RESULT);

    await parseClipQuery(
      { query: 'funny marketing clips', availableTopics: ['marketing', 'finance'] },
      { openai },
    );

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(JSON.parse(call.messages[1].content)).toEqual({
      query: 'funny marketing clips',
      availableTopics: ['marketing', 'finance'],
    });
  });

  it('converts nulls to undefined and passes through set fields', async () => {
    const openai = fakeOpenAI({
      minScore: 70,
      platform: 'TIKTOK',
      minDuration: null,
      maxDuration: 30,
      topics: ['marketing'],
      emotion: null,
      keyword: null,
      summary: 'Score >= 70, under 30s, about marketing.',
    });

    const result = await parseClipQuery(
      { query: 'best marketing clips under 30s for tiktok', availableTopics: ['marketing'] },
      { openai },
    );

    expect(result).toEqual({
      minScore: 70,
      platform: 'TIKTOK',
      maxDuration: 30,
      topics: ['marketing'],
      summary: 'Score >= 70, under 30s, about marketing.',
    });
  });

  it('drops any topic not present in availableTopics (never invents a topic that matches zero clips)', async () => {
    const openai = fakeOpenAI({
      ...NULL_RESULT,
      topics: ['marketing', 'made-up-topic'],
    });

    const result = await parseClipQuery(
      { query: 'marketing clips', availableTopics: ['marketing', 'finance'] },
      { openai },
    );

    expect(result.topics).toEqual(['marketing']);
  });

  it('drops an emotion outside the 7-class FER+ set', async () => {
    const openai = fakeOpenAI({ ...NULL_RESULT, emotion: 'excited' });

    const result = await parseClipQuery(
      { query: 'exciting clips', availableTopics: [] },
      { openai },
    );

    expect(result.emotion).toBeUndefined();
  });

  it('keeps a valid emotion', async () => {
    const openai = fakeOpenAI({ ...NULL_RESULT, emotion: 'happy' });

    const result = await parseClipQuery(
      { query: 'clips where I look happy', availableTopics: [] },
      { openai },
    );

    expect(result.emotion).toBe('happy');
  });

  it('drops an invalid platform value', async () => {
    const openai = fakeOpenAI({ ...NULL_RESULT, platform: 'SNAPCHAT' });

    const result = await parseClipQuery(
      { query: 'clips for snapchat', availableTopics: [] },
      { openai },
    );

    expect(result.platform).toBeUndefined();
  });

  it('clamps minScore to 0-100', async () => {
    const openai = fakeOpenAI({ ...NULL_RESULT, minScore: 150 });

    const result = await parseClipQuery(
      { query: 'the best clips', availableTopics: [] },
      { openai },
    );

    expect(result.minScore).toBe(100);
  });

  it('drops a negative duration', async () => {
    const openai = fakeOpenAI({ ...NULL_RESULT, minDuration: -5 });

    const result = await parseClipQuery({ query: 'short clips', availableTopics: [] }, { openai });

    expect(result.minDuration).toBeUndefined();
  });

  it('trims and drops an empty keyword', async () => {
    const openai = fakeOpenAI({ ...NULL_RESULT, keyword: '   ' });

    const result = await parseClipQuery({ query: 'clips', availableTopics: [] }, { openai });

    expect(result.keyword).toBeUndefined();
  });

  it('returns an empty summary and no filters when the LLM returns no content', async () => {
    const openai = {
      chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{}] }) } },
    } as unknown as OpenAI;

    const result = await parseClipQuery({ query: 'clips', availableTopics: [] }, { openai });

    expect(result).toEqual({ summary: '' });
  });
});
