import type OpenAI from 'openai';
import { extractRawConnections } from './extract-raw-connections';
import type { EvidenceGroup } from './group-evidence';
import { evidence } from './test-fixtures';

function fakeOpenAI(connections: unknown[]): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ connections }) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const GROUPS: EvidenceGroup[] = [
  {
    segmentIndex: 0,
    startTime: 10,
    endTime: 11.5,
    evidence: [
      evidence({
        id: 'transcript:0',
        modality: 'transcript',
        startTime: 10,
        endTime: 11.5,
        value: 'lihat angka ini',
      }),
      evidence({
        id: 'ocr:0',
        modality: 'ocr',
        startTime: 10.8,
        endTime: 11.3,
        value: '$500 Million',
      }),
    ],
  },
];

describe('extractRawConnections', () => {
  it('returns an empty array and skips the LLM call when there are no reasoning-worthy groups', async () => {
    const openai = fakeOpenAI([]);

    const result = await extractRawConnections([], { openai });

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('parses a well-formed LLM response into MultimodalConnection[]', async () => {
    const openai = fakeOpenAI([
      {
        relation: 'refers_to',
        evidenceRefs: ['transcript:0', 'ocr:0'],
        modalities: ['transcript', 'ocr'],
        startTime: 10,
        endTime: 11.5,
        confidence: 0.8,
        reason: 'the speaker points at the on-screen figure',
      },
    ]);

    const result = await extractRawConnections(GROUPS, { openai });

    expect(result).toHaveLength(1);
    expect(result[0].relation).toBe('refers_to');
    expect(result[0].evidenceRefs).toEqual(['transcript:0', 'ocr:0']);
  });

  it('clamps confidence to 0-1 and trims reason', async () => {
    const openai = fakeOpenAI([
      {
        relation: 'co_occurs_with',
        evidenceRefs: ['transcript:0', 'ocr:0'],
        modalities: ['transcript', 'ocr'],
        startTime: 10,
        endTime: 11.5,
        confidence: 3,
        reason: '  padded  ',
      },
    ]);

    const result = await extractRawConnections(GROUPS, { openai });

    expect(result[0].confidence).toBe(1);
    expect(result[0].reason).toBe('padded');
  });

  it('sends a strict json_schema response format naming every relation type and evidence ids', async () => {
    const openai = fakeOpenAI([]);

    await extractRawConnections(GROUPS, { openai });

    const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
    expect(call.model).toBe('gpt-4o-mini');
    expect(call.response_format.type).toBe('json_schema');
    expect(call.response_format.json_schema.strict).toBe(true);
    expect(call.messages[1].content).toContain('transcript:0');
    expect(call.messages[1].content).toContain('ocr:0');
  });
});
