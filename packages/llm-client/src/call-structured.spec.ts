import type { StructuredCallInput } from '@speedora/contracts';
import type OpenAI from 'openai';
import { callStructured } from './call-structured';

// Pure fixture-based tests - no DB/queue/Sentry mocking, since the module
// never touches any of that. Only the LLM call itself is faked, via the
// injected deps.openai (same convention as clip-scoring's own tests).
function fakeOpenAI(content: string | null): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const INPUT: StructuredCallInput = {
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a test.' },
    { role: 'user', content: 'Say hi.' },
  ],
  responseFormat: {
    name: 'test_schema',
    schema: { type: 'object', properties: { greeting: { type: 'string' } } },
  },
};

describe('callStructured', () => {
  it('parses and returns the completion content as JSON', async () => {
    const openai = fakeOpenAI(JSON.stringify({ greeting: 'hi' }));

    const result = await callStructured<{ greeting: string }>(INPUT, { openai });

    expect(result).toEqual({ greeting: 'hi' });
  });

  it('passes model/messages/response_format through to the OpenAI client unchanged', async () => {
    const openai = fakeOpenAI(JSON.stringify({ greeting: 'hi' }));

    await callStructured(INPUT, { openai });

    expect(openai.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: INPUT.messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'test_schema',
          strict: true,
          schema: INPUT.responseFormat.schema,
        },
      },
    });
  });

  it('throws when the completion has no content', async () => {
    const openai = fakeOpenAI(null);

    await expect(callStructured(INPUT, { openai })).rejects.toThrow(
      'callStructured: LLM completion returned no content.',
    );
  });
});
