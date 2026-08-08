import type OpenAI from 'openai';
import { reasonMultimodal, type ReasonMultimodalInput } from './reason-multimodal';
import { ocrTrack, sceneCutEvent, speakerTimelineEntry, transcriptSegment } from './test-fixtures';

function fakeOpenAI(connections: unknown[]): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ connections }) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const EMPTY_INPUT: ReasonMultimodalInput = {
  clipId: 'clip-1',
  transcript: [],
  sceneCutEvents: [],
  ocrTracks: [],
  objectTracks: [],
  facialEmotions: [],
  gestures: [],
  speakerTimeline: [],
};

describe('reasonMultimodal', () => {
  it('skips the LLM call entirely for a transcript-only clip (no cross-modal evidence groups)', async () => {
    const openai = fakeOpenAI([]);

    const result = await reasonMultimodal(
      {
        ...EMPTY_INPUT,
        transcript: [transcriptSegment({ start: 0, end: 2, text: 'hello world' })],
      },
      { openai },
    );

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      clipId: 'clip-1',
      evidence: expect.arrayContaining([expect.objectContaining({ modality: 'transcript' })]),
      connections: [],
      modalityCoverage: { transcript: 1 },
    });
  });

  it('runs end to end: normalize -> group -> LLM reasoning -> validation, producing a real result', async () => {
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

    const result = await reasonMultimodal(
      {
        ...EMPTY_INPUT,
        transcript: [transcriptSegment({ start: 10, end: 11.5, text: 'lihat angka ini' })],
        ocrTracks: [ocrTrack({ startTime: 10.8, endTime: 11.3, text: '$500 Million' })],
        sceneCutEvents: [sceneCutEvent({ t: 10.5, type: 'hard_cut' })],
        speakerTimeline: [speakerTimelineEntry({ speaker: 'Speaker A', start: 10, end: 11.5 })],
      },
      { openai },
    );

    expect(result.clipId).toBe('clip-1');
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].modalities.sort()).toEqual(['ocr', 'transcript']);
    expect(result.modalityCoverage).toEqual({ transcript: 1, ocr: 1, scene: 1, speaker: 1 });
  });

  it('drops a hallucinated connection end to end (evidence id never sent to the LLM)', async () => {
    const openai = fakeOpenAI([
      {
        relation: 'refers_to',
        evidenceRefs: ['transcript:0', 'ocr:does-not-exist'],
        modalities: ['transcript', 'ocr'],
        startTime: 10,
        endTime: 11.5,
        confidence: 0.8,
        reason: 'fabricated',
      },
    ]);

    const result = await reasonMultimodal(
      {
        ...EMPTY_INPUT,
        transcript: [transcriptSegment({ start: 10, end: 11.5, text: 'lihat angka ini' })],
        ocrTracks: [ocrTrack({ startTime: 10.8, endTime: 11.3, text: '$500 Million' })],
      },
      { openai },
    );

    expect(result.connections).toEqual([]);
  });

  it('propagates an LLM failure rather than swallowing it (module throws, adapter catches)', async () => {
    const openai = {
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('LLM unavailable')) } },
    } as unknown as OpenAI;

    await expect(
      reasonMultimodal(
        {
          ...EMPTY_INPUT,
          transcript: [transcriptSegment({ start: 10, end: 11.5, text: 'lihat angka ini' })],
          ocrTracks: [ocrTrack({ startTime: 10.8, endTime: 11.3, text: '$500 Million' })],
        },
        { openai },
      ),
    ).rejects.toThrow('LLM unavailable');
  });
});
