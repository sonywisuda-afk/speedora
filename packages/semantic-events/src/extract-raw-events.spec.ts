import type { SemanticEventDetectionSegment } from '@speedora/contracts';
import type OpenAI from 'openai';
import { extractRawEvents } from './extract-raw-events';

function fakeOpenAI(events: unknown[]): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ events }) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const SEGMENTS: SemanticEventDetectionSegment[] = [
  { start: 0, end: 5, text: 'I once made a huge mistake investing $500 million.' },
  { start: 5, end: 10, text: 'But it taught me an important lesson.' },
];

describe('extractRawEvents', () => {
  it('returns an empty array and skips the LLM call when there are no segments', async () => {
    const openai = fakeOpenAI([]);

    const result = await extractRawEvents([], { openai });

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('parses a well-formed LLM response into RawSemanticEvent[]', async () => {
    const openai = fakeOpenAI([
      { type: 'mistake', t: 2, confidence: 0.8, importance: 0.6, reason: 'admits an error' },
      { type: 'life_lesson', t: 7, confidence: 0.7, importance: 0.5, reason: 'shares a lesson' },
    ]);

    const result = await extractRawEvents(SEGMENTS, { openai });

    expect(result).toEqual([
      { type: 'mistake', t: 2, confidence: 0.8, importance: 0.6, reason: 'admits an error' },
      { type: 'life_lesson', t: 7, confidence: 0.7, importance: 0.5, reason: 'shares a lesson' },
    ]);
  });

  it('clamps confidence/importance to 0-1 and t to the transcript span', async () => {
    const openai = fakeOpenAI([
      { type: 'money', t: 999, confidence: 5, importance: -2, reason: '  padded  ' },
    ]);

    const result = await extractRawEvents(SEGMENTS, { openai });

    expect(result[0].t).toBe(10);
    expect(result[0].confidence).toBe(1);
    expect(result[0].importance).toBe(0);
    expect(result[0].reason).toBe('padded');
  });

  it('sends a strict json_schema response format naming every taxonomy value', async () => {
    const openai = fakeOpenAI([]);

    await extractRawEvents(SEGMENTS, { openai });

    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(call.model).toBe('gpt-4o-mini');
    expect(call.response_format.type).toBe('json_schema');
    expect(call.response_format.json_schema.strict).toBe(true);
    expect(call.messages[1].content).toContain('$500 million');
  });
});
