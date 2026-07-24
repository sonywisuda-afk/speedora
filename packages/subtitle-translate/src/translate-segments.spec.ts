import type OpenAI from 'openai';
import { translateSegments } from './translate-segments';

// Pure fixture-based tests - no DB/queue/Sentry mocking, same posture as
// @speedora/clip-scoring's own spec (this module never touches any of
// that). Only the LLM call itself is faked, via the injected deps.openai.
function fakeOpenAI(translations: unknown[]): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ translations }) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe('translateSegments', () => {
  it('returns no translations and skips the LLM call when there are no segments', async () => {
    const openai = fakeOpenAI([]);

    const result = await translateSegments(
      { segments: [], languageCode: 'en' },
      { openai },
    );

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(result).toEqual({ translations: [] });
  });

  it('sends every segment id/text in one call and returns the translations', async () => {
    const openai = fakeOpenAI([
      { id: 'seg-1', text: 'Hello' },
      { id: 'seg-2', text: 'World' },
    ]);

    const result = await translateSegments(
      {
        segments: [
          { id: 'seg-1', text: 'Halo' },
          { id: 'seg-2', text: 'Dunia' },
        ],
        languageCode: 'en',
      },
      { openai },
    );

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(JSON.parse(call.messages[1].content)).toEqual({
      segments: [
        { id: 'seg-1', text: 'Halo' },
        { id: 'seg-2', text: 'Dunia' },
      ],
    });
    expect(result).toEqual({
      translations: [
        { id: 'seg-1', text: 'Hello' },
        { id: 'seg-2', text: 'World' },
      ],
    });
  });

  it('drops any id in the response that does not match a real input segment', async () => {
    const openai = fakeOpenAI([
      { id: 'seg-1', text: 'Hello' },
      { id: 'made-up-id', text: 'Ghost' },
    ]);

    const result = await translateSegments(
      { segments: [{ id: 'seg-1', text: 'Halo' }], languageCode: 'en' },
      { openai },
    );

    expect(result).toEqual({ translations: [{ id: 'seg-1', text: 'Hello' }] });
  });

  it('returns no translations when the LLM returns no content', async () => {
    const openai = {
      chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{}] }) } },
    } as unknown as OpenAI;

    const result = await translateSegments(
      { segments: [{ id: 'seg-1', text: 'Halo' }], languageCode: 'en' },
      { openai },
    );

    expect(result).toEqual({ translations: [] });
  });
});
