import type { NarrativeGraphDetectionSegment } from '@speedora/contracts';
import type OpenAI from 'openai';
import { buildNarrativeGraph } from './build-narrative-graph';

function fakeOpenAI(content: Record<string, unknown>): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const SEGMENTS: NarrativeGraphDetectionSegment[] = [
  { start: 0, end: 5, text: 'I made a mistake.' },
  { start: 5, end: 15, text: 'Here is what I learned.' },
];

describe('buildNarrativeGraph', () => {
  it('orchestrates the LLM call and structural validation into one NarrativeGraph', async () => {
    const openai = fakeOpenAI({
      unsegmented: false,
      segments: [
        { id: 0, type: 'hook', startTime: 0, endTime: 5, confidence: 0.8, reason: 'a' },
        { id: 1, type: 'takeaway', startTime: 5, endTime: 15, confidence: 0.7, reason: 'b' },
      ],
      relations: [],
    });

    const result = await buildNarrativeGraph(
      { segments: SEGMENTS, semanticEvents: null, clipDurationSeconds: 15 },
      { openai },
    );

    expect(result.unsegmented).toBe(false);
    expect(result.segments).toHaveLength(2);
  });

  it('collapses to unsegmented when the LLM output fails structural validation', async () => {
    const openai = fakeOpenAI({
      unsegmented: false,
      segments: [
        { id: 0, type: 'hook', startTime: 0, endTime: 5, confidence: 0.8, reason: 'a' },
        // Only 1 real segment after this one is out of clip bounds -> fails validateGraph.
        { id: 1, type: 'cta', startTime: 100, endTime: 200, confidence: 0.7, reason: 'b' },
      ],
      relations: [],
    });

    const result = await buildNarrativeGraph(
      { segments: SEGMENTS, semanticEvents: null, clipDurationSeconds: 15 },
      { openai },
    );

    expect(result).toEqual({ segments: [], relations: [], unsegmented: true });
  });
});
