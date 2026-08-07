import type { NarrativeGraph } from '@speedora/contracts';
import { validateGraph } from './validate-graph';

const UNSEGMENTED: NarrativeGraph = { segments: [], relations: [], unsegmented: true };

function segment(overrides: Partial<NarrativeGraph['segments'][number]> = {}) {
  return {
    id: 0,
    type: 'hook' as const,
    startTime: 0,
    endTime: 5,
    confidence: 0.9,
    reason: 'test',
    ...overrides,
  };
}

describe('validateGraph', () => {
  it('passes through an already-unsegmented graph unchanged', () => {
    expect(validateGraph(UNSEGMENTED, 30)).toEqual(UNSEGMENTED);
  });

  it('collapses to unsegmented when there is only 1 segment', () => {
    const raw: NarrativeGraph = {
      segments: [segment()],
      relations: [],
      unsegmented: false,
    };
    expect(validateGraph(raw, 30)).toEqual(UNSEGMENTED);
  });

  it('collapses to unsegmented when a segment has startTime >= endTime', () => {
    const raw: NarrativeGraph = {
      segments: [segment({ id: 0 }), segment({ id: 1, startTime: 10, endTime: 5 })],
      relations: [],
      unsegmented: false,
    };
    expect(validateGraph(raw, 30)).toEqual(UNSEGMENTED);
  });

  it('collapses to unsegmented when a segment falls outside the clip bounds', () => {
    const raw: NarrativeGraph = {
      segments: [segment({ id: 0 }), segment({ id: 1, startTime: 20, endTime: 100 })],
      relations: [],
      unsegmented: false,
    };
    expect(validateGraph(raw, 30)).toEqual(UNSEGMENTED);
  });

  it('tolerates a small floating-point overshoot at the clip boundary', () => {
    const raw: NarrativeGraph = {
      segments: [segment({ id: 0 }), segment({ id: 1, startTime: 5, endTime: 30.2 })],
      relations: [],
      unsegmented: false,
    };
    expect(validateGraph(raw, 30).unsegmented).toBe(false);
  });

  it('collapses to unsegmented when a relation references a non-existent segment id', () => {
    const raw: NarrativeGraph = {
      segments: [segment({ id: 0 }), segment({ id: 1, startTime: 5, endTime: 10 })],
      relations: [{ fromSegmentId: 0, toSegmentId: 99, type: 'leads_to' }],
      unsegmented: false,
    };
    expect(validateGraph(raw, 30)).toEqual(UNSEGMENTED);
  });

  it('passes through a structurally valid graph unchanged, including non-adjacent resolves', () => {
    const raw: NarrativeGraph = {
      segments: [
        segment({ id: 0, type: 'hook', startTime: 0, endTime: 5 }),
        segment({ id: 1, type: 'problem', startTime: 5, endTime: 10 }),
        segment({ id: 2, type: 'takeaway', startTime: 20, endTime: 25 }),
      ],
      relations: [
        { fromSegmentId: 0, toSegmentId: 1, type: 'leads_to' },
        { fromSegmentId: 2, toSegmentId: 1, type: 'resolves' },
      ],
      unsegmented: false,
    };
    expect(validateGraph(raw, 30)).toEqual(raw);
  });
});
