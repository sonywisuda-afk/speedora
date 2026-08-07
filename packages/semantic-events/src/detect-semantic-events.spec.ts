import type { SemanticEventDetectionSegment } from '@speedora/contracts';
import type OpenAI from 'openai';
import { detectSemanticEvents } from './detect-semantic-events';

function fakeOpenAI(events: unknown[]): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ events }) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const SEGMENTS: SemanticEventDetectionSegment[] = [
  { start: 0, end: 5, text: 'Breaking news: we just raised $500 million.' },
];

describe('detectSemanticEvents', () => {
  it('orchestrates the LLM call and grounding into a full SemanticEvent[]', async () => {
    const openai = fakeOpenAI([
      { type: 'breaking_news', t: 1, confidence: 0.9, importance: 0.9, reason: 'announces news' },
    ]);

    const result = await detectSemanticEvents(
      { segments: SEGMENTS, ocrTracks: [], objectTracks: [] },
      { openai },
    );

    expect(result).toEqual([
      {
        type: 'breaking_news',
        t: 1,
        confidence: 0.9,
        importance: 0.9,
        reason: 'announces news',
        evidence: [],
      },
    ]);
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when no segments are given', async () => {
    const openai = fakeOpenAI([]);

    const result = await detectSemanticEvents(
      { segments: [], ocrTracks: [], objectTracks: [] },
      { openai },
    );

    expect(result).toEqual([]);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });
});
