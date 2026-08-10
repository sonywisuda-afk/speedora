import type { NarrativeGraph, NarrativeSegment } from '@speedora/contracts';
import { deriveNarrativeGraphScore } from './derive-narrative-graph-score';

function segment(overrides: Partial<NarrativeSegment> = {}): NarrativeSegment {
  return {
    id: 0,
    type: 'setup',
    startTime: 0,
    endTime: 10,
    confidence: 0.8,
    reason: 'because',
    ...overrides,
  };
}

describe('deriveNarrativeGraphScore', () => {
  it('returns a neutral midpoint (50) when the graph is null (the LLM call failed)', () => {
    expect(deriveNarrativeGraphScore(null)).toBe(50);
  });

  it('scores below neutral for an unsegmented (but real, successful) result', () => {
    const unsegmented: NarrativeGraph = { segments: [], relations: [], unsegmented: true };
    expect(deriveNarrativeGraphScore(unsegmented)).toBe(40);
    expect(deriveNarrativeGraphScore(unsegmented)).toBeLessThan(50);
  });

  it('rewards a segmented graph that reaches a payoff segment type over one that never does', () => {
    const withPayoff = deriveNarrativeGraphScore({
      segments: [segment({ type: 'setup' }), segment({ id: 1, type: 'resolution' })],
      relations: [],
      unsegmented: false,
    });
    const withoutPayoff = deriveNarrativeGraphScore({
      segments: [segment({ type: 'setup' }), segment({ id: 1, type: 'conflict' })],
      relations: [],
      unsegmented: false,
    });

    expect(withPayoff).toBeGreaterThan(withoutPayoff);
  });

  it('scores higher segment confidence higher, all else equal', () => {
    const highConfidence = deriveNarrativeGraphScore({
      segments: [segment({ confidence: 1 })],
      relations: [],
      unsegmented: false,
    });
    const lowConfidence = deriveNarrativeGraphScore({
      segments: [segment({ confidence: 0 })],
      relations: [],
      unsegmented: false,
    });

    expect(highConfidence).toBeGreaterThan(lowConfidence);
  });

  it('stays within [0, 100] at both extremes', () => {
    const high = deriveNarrativeGraphScore({
      segments: [segment({ type: 'resolution', confidence: 1 })],
      relations: [],
      unsegmented: false,
    });
    const low = deriveNarrativeGraphScore({
      segments: [segment({ type: 'setup', confidence: 0 })],
      relations: [],
      unsegmented: false,
    });

    expect(high).toBe(100);
    expect(low).toBe(0);
  });
});
