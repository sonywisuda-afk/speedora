import type { SeoCopyInput } from '@speedora/contracts';
import type OpenAI from 'openai';
import { generatePlatformCopy } from './generate-platform-copy';

// Pure fixture-based tests - no DB/queue/Sentry mocking at all, since the
// module never touches any of that. Only the LLM call itself is faked, via
// the injected deps.openai - same convention as
// @speedora/clip-scoring's score-clip-candidates.spec.ts.
function fakeOpenAI(response: unknown): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(response) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function baseInput(overrides: Partial<SeoCopyInput> = {}): SeoCopyInput {
  return {
    platform: 'TIKTOK',
    hookText: 'You will not believe what happened next',
    topics: ['productivity'],
    keywords: ['focus', 'deep work'],
    ctaText: 'follow for part 2',
    reason: 'a strong self-contained moment',
    ...overrides,
  };
}

describe('generatePlatformCopy', () => {
  it('sanitizes hashtags and trims caption/description on a successful call', async () => {
    const openai = fakeOpenAI({
      caption: '  Stop scrolling - this changes everything  ',
      hashtags: ['#Productivity', '  focus ', '', '#DeepWork'],
      description: null,
    });

    const result = await generatePlatformCopy(baseInput(), { openai });

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      caption: 'Stop scrolling - this changes everything',
      hashtags: ['Productivity', 'focus', 'DeepWork'],
      description: null,
    });
  });

  it("includes platform in the prompt and passes only already-computed clip fields, never a transcript", async () => {
    const openai = fakeOpenAI({ caption: 'x', hashtags: [], description: null });

    await generatePlatformCopy(baseInput({ platform: 'YOUTUBE' }), { openai });

    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    const allContent = call.messages.map((m: { content: string }) => m.content).join('\n');
    expect(allContent).toContain('YOUTUBE');
    expect(allContent).toContain('You will not believe what happened next');
    // Deliberately clarifies IN PROSE that no transcript is sent, but never
    // actually sends transcript text/segments - the user message only ever
    // carries hookText/topics/keywords/ctaText/reason.
    expect(call.messages).toHaveLength(2);
    expect(call.messages[1].content).not.toMatch(/\[\d/); // no [start-end] segment markers
  });

  it('asks for a description only for platforms whose guidance includes one', async () => {
    const openai = fakeOpenAI({ caption: 'x', hashtags: [], description: null });

    await generatePlatformCopy(baseInput({ platform: 'LINKEDIN' }), { openai });

    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    const systemMessage = call.messages[0].content as string;
    expect(systemMessage).toContain('no separate description field');
  });

  it('trims a non-empty description to a string, and normalizes blank to null', async () => {
    const openai = fakeOpenAI({
      caption: 'x',
      hashtags: [],
      description: '  a real description  ',
    });

    const result = await generatePlatformCopy(baseInput({ platform: 'YOUTUBE' }), { openai });
    expect(result.description).toBe('a real description');

    const openaiBlank = fakeOpenAI({ caption: 'x', hashtags: [], description: '   ' });
    const resultBlank = await generatePlatformCopy(baseInput({ platform: 'YOUTUBE' }), {
      openai: openaiBlank,
    });
    expect(resultBlank.description).toBeNull();
  });

  it('degrades to an empty result rather than throwing when the LLM returns no content', async () => {
    const openai = {
      chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{}] }) } },
    } as unknown as OpenAI;

    const result = await generatePlatformCopy(baseInput(), { openai });

    expect(result).toEqual({ caption: '', hashtags: [], description: null });
  });
});
