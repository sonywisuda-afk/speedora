import type { MultimodalConnection, MultimodalEvidence } from '@speedora/contracts';
import { validateConnections } from './validate-connections';
import { evidence } from './test-fixtures';

function connection(overrides: Partial<MultimodalConnection> = {}): MultimodalConnection {
  return {
    relation: 'refers_to',
    evidenceRefs: ['transcript:0', 'ocr:0'],
    modalities: ['transcript', 'ocr'],
    startTime: 10,
    endTime: 11,
    confidence: 0.8,
    reason: 'the transcript refers to the on-screen text',
    ...overrides,
  };
}

const EVIDENCE: MultimodalEvidence[] = [
  evidence({
    id: 'transcript:0',
    modality: 'transcript',
    startTime: 10,
    endTime: 11.5,
    value: 'lihat angka ini',
  }),
  evidence({ id: 'ocr:0', modality: 'ocr', startTime: 10.8, endTime: 11.3, value: '$500 Million' }),
  evidence({
    id: 'gesture:0',
    modality: 'gesture',
    startTime: 10.2,
    endTime: 10.2,
    value: 'pointing_up',
  }),
];

describe('validateConnections', () => {
  it('accepts a connection whose evidenceRefs all resolve and span >= 2 modalities', () => {
    const result = validateConnections([connection()], EVIDENCE);

    expect(result).toHaveLength(1);
    expect(result[0].modalities.sort()).toEqual(['ocr', 'transcript']);
  });

  it('drops a connection citing a fabricated/hallucinated evidence id (the guard from Part 6, Section 10)', () => {
    const result = validateConnections(
      [connection({ evidenceRefs: ['transcript:0', 'ocr:does-not-exist'] })],
      EVIDENCE,
    );

    expect(result).toEqual([]);
  });

  it('drops a connection whose resolved evidence spans only 1 distinct modality', () => {
    const result = validateConnections(
      [
        connection({
          evidenceRefs: ['transcript:0', 'transcript:0'],
          modalities: ['transcript'],
        }),
      ],
      EVIDENCE,
    );

    expect(result).toEqual([]);
  });

  it('drops a connection with fewer than 2 evidenceRefs after deduplication', () => {
    const result = validateConnections([connection({ evidenceRefs: ['transcript:0'] })], EVIDENCE);

    expect(result).toEqual([]);
  });

  it('drops a connection with an unknown relation value (malformed LLM output, defense-in-depth)', () => {
    const result = validateConnections(
      [connection({ relation: 'invented_relation' as MultimodalConnection['relation'] })],
      EVIDENCE,
    );

    expect(result).toEqual([]);
  });

  it('clamps an out-of-range confidence to [0, 1]', () => {
    const result = validateConnections([connection({ confidence: 1.4 })], EVIDENCE);
    expect(result[0].confidence).toBe(1);

    const resultLow = validateConnections([connection({ confidence: -0.2 })], EVIDENCE);
    expect(resultLow[0].confidence).toBe(0);
  });

  it("falls back to a generic reason when the LLM's own reason is empty", () => {
    const result = validateConnections([connection({ reason: '  ' })], EVIDENCE);
    expect(result[0].reason.length).toBeGreaterThan(0);
  });

  it('recomputes modalities/startTime/endTime from resolved evidence, never trusting the raw connection', () => {
    const result = validateConnections(
      [
        connection({
          evidenceRefs: ['transcript:0', 'ocr:0', 'gesture:0'],
          modalities: ['transcript'], // deliberately wrong/incomplete, as if the LLM under-reported
          startTime: 999, // deliberately wrong
          endTime: 999,
        }),
      ],
      EVIDENCE,
    );

    expect(result[0].modalities.sort()).toEqual(['gesture', 'ocr', 'transcript']);
    expect(result[0].startTime).toBe(10);
    expect(result[0].endTime).toBe(11.5);
  });

  it('returns an empty array (a real successful result) when there are no raw connections at all', () => {
    expect(validateConnections([], EVIDENCE)).toEqual([]);
  });
});
