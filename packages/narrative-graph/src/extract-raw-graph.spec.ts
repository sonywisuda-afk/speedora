import type { NarrativeGraphDetectionSegment, SemanticEvent } from '@speedora/contracts';
import type OpenAI from 'openai';
import { extractRawGraph } from './extract-raw-graph';

function fakeOpenAI(content: Record<string, unknown>): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const SEGMENTS: NarrativeGraphDetectionSegment[] = [
  { start: 0, end: 5, text: 'Here is a huge problem I faced.' },
  { start: 5, end: 15, text: 'Eventually I solved it, and here is the lesson.' },
];

describe('extractRawGraph', () => {
  it('returns unsegmented and skips the LLM call when there are no segments', async () => {
    const openai = fakeOpenAI({});

    const result = await extractRawGraph([], null, { openai });

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(result).toEqual({ segments: [], relations: [], unsegmented: true });
  });

  it('parses a well-formed segmented response', async () => {
    const openai = fakeOpenAI({
      unsegmented: false,
      segments: [
        { id: 0, type: 'problem', startTime: 0, endTime: 5, confidence: 0.8, reason: 'states it' },
        {
          id: 1,
          type: 'takeaway',
          startTime: 5,
          endTime: 15,
          confidence: 0.7,
          reason: 'gives lesson',
        },
      ],
      relations: [{ fromSegmentId: 1, toSegmentId: 0, type: 'resolves' }],
    });

    const result = await extractRawGraph(SEGMENTS, null, { openai });

    expect(result.unsegmented).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.relations).toEqual([{ fromSegmentId: 1, toSegmentId: 0, type: 'resolves' }]);
  });

  it('short-circuits to empty segments/relations when the LLM reports unsegmented', async () => {
    const openai = fakeOpenAI({ unsegmented: true, segments: [], relations: [] });

    const result = await extractRawGraph(SEGMENTS, null, { openai });

    expect(result).toEqual({ segments: [], relations: [], unsegmented: true });
  });

  it('clamps confidence to 0-1 and trims reason', async () => {
    const openai = fakeOpenAI({
      unsegmented: false,
      segments: [
        { id: 0, type: 'hook', startTime: 0, endTime: 5, confidence: 5, reason: '  padded  ' },
        { id: 1, type: 'cta', startTime: 5, endTime: 15, confidence: -1, reason: 'x' },
      ],
      relations: [],
    });

    const result = await extractRawGraph(SEGMENTS, null, { openai });

    expect(result.segments[0].confidence).toBe(1);
    expect(result.segments[0].reason).toBe('padded');
    expect(result.segments[1].confidence).toBe(0);
  });

  it('includes Phase 2 semantic events as context when present, and omits it when null', async () => {
    const openai = fakeOpenAI({ unsegmented: true, segments: [], relations: [] });
    const events: SemanticEvent[] = [
      {
        type: 'mistake',
        t: 2,
        confidence: 0.9,
        importance: 0.8,
        evidence: [],
        reason: 'admits it',
      },
    ];

    await extractRawGraph(SEGMENTS, events, { openai });
    const withEvents = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(withEvents.messages[0].content).toContain('mistake: admits it');

    jest.clearAllMocks();
    await extractRawGraph(SEGMENTS, null, { openai });
    const withoutEvents = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(withoutEvents.messages[0].content).not.toContain('Detected narrative events');
  });

  it('sends a strict json_schema response format naming every taxonomy value', async () => {
    const openai = fakeOpenAI({ unsegmented: true, segments: [], relations: [] });

    await extractRawGraph(SEGMENTS, null, { openai });

    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(call.model).toBe('gpt-4o-mini');
    expect(call.response_format.type).toBe('json_schema');
    expect(call.response_format.json_schema.strict).toBe(true);
  });
});
