import {
  computeCandidateSimilarity,
  detectRedundancy,
  selectDiverseShortlist,
  type DiversityCandidate,
} from './compute-candidate-similarity';

function candidate(overrides: Partial<DiversityCandidate>): DiversityCandidate {
  return {
    index: 0,
    score: 50,
    startTime: 0,
    endTime: 30,
    text: 'default text',
    semanticEventTypes: [],
    ...overrides,
  };
}

describe('computeCandidateSimilarity', () => {
  it('is high for near-duplicate text and event types', () => {
    const a = candidate({
      text: 'I lost a billion rupiah in one bad trade',
      semanticEventTypes: ['failure', 'money'],
    });
    const b = candidate({
      text: 'I lost a billion rupiah on one terrible trade',
      semanticEventTypes: ['failure', 'money'],
    });
    expect(computeCandidateSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it('is low for genuinely distinct candidates', () => {
    const a = candidate({
      text: 'How I built my morning routine for productivity',
      semanticEventTypes: ['tutorial'],
    });
    const b = candidate({
      text: 'The legal battle over our company trademark',
      semanticEventTypes: ['lawsuit'],
    });
    expect(computeCandidateSimilarity(a, b)).toBeLessThan(0.3);
  });

  it('handles empty text/event arrays without crashing', () => {
    const a = candidate({ text: '', semanticEventTypes: [] });
    const b = candidate({ text: '', semanticEventTypes: [] });
    expect(computeCandidateSimilarity(a, b)).toBe(0);
  });
});

describe('detectRedundancy', () => {
  it('flags a near-duplicate topic at a different, non-overlapping timestamp', () => {
    const target = candidate({
      index: 0,
      startTime: 0,
      endTime: 30,
      text: 'I lost a billion rupiah in one bad trade',
      semanticEventTypes: ['failure', 'money'],
    });
    const other = candidate({
      index: 1,
      startTime: 100,
      endTime: 130,
      text: 'I lost a billion rupiah on one terrible trade',
      semanticEventTypes: ['failure', 'money'],
    });
    const result = detectRedundancy(target, [target, other]);
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('does not flag a candidate that overlaps in time (handled upstream)', () => {
    const target = candidate({
      index: 0,
      startTime: 0,
      endTime: 30,
      text: 'same content here',
      semanticEventTypes: ['failure'],
    });
    const overlapping = candidate({
      index: 1,
      startTime: 10,
      endTime: 40,
      text: 'same content here',
      semanticEventTypes: ['failure'],
    });
    const result = detectRedundancy(target, [target, overlapping]);
    expect(result.penalty).toBe(0);
  });

  it('does not flag distinct candidates', () => {
    const target = candidate({
      index: 0,
      text: 'a story about growing up on a farm',
      semanticEventTypes: [],
    });
    const other = candidate({
      index: 1,
      startTime: 100,
      endTime: 130,
      text: 'a legal dispute over patents',
      semanticEventTypes: [],
    });
    expect(detectRedundancy(target, [target, other]).penalty).toBe(0);
  });
});

describe('selectDiverseShortlist', () => {
  it('prefers a lower-scored but distinct candidate over a redundant higher-scored one', () => {
    const a = candidate({
      index: 0,
      score: 90,
      startTime: 0,
      endTime: 30,
      text: 'I lost a billion rupiah in one bad trade',
      semanticEventTypes: ['failure', 'money'],
    });
    const b = candidate({
      index: 1,
      score: 85,
      startTime: 100,
      endTime: 130,
      text: 'I lost a billion rupiah on one terrible trade',
      semanticEventTypes: ['failure', 'money'],
    });
    const c = candidate({
      index: 2,
      score: 70,
      startTime: 200,
      endTime: 230,
      text: 'a completely different story about my childhood dog',
      semanticEventTypes: ['transformation'],
    });

    const result = selectDiverseShortlist([a, b, c], 2);

    expect(result.map((candidate) => candidate.index)).toEqual([0, 2]);
  });

  it('never returns fewer than min(targetSize, candidates.length)', () => {
    const a = candidate({ index: 0, score: 90, text: 'identical wording here for the test' });
    const b = candidate({
      index: 1,
      score: 85,
      startTime: 100,
      endTime: 130,
      text: 'identical wording here for the test',
    });
    const c = candidate({
      index: 2,
      score: 80,
      startTime: 200,
      endTime: 230,
      text: 'identical wording here for the test',
    });

    const result = selectDiverseShortlist([a, b, c], 3);
    expect(result).toHaveLength(3);
  });

  it('respects targetSize', () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate({
        index: i,
        score: 100 - i,
        startTime: i * 100,
        endTime: i * 100 + 30,
        text: `unique story number ${i}`,
      }),
    );
    expect(selectDiverseShortlist(candidates, 3)).toHaveLength(3);
  });
});
