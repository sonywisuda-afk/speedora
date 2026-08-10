import type { ClipScores, ShortlistCandidateInput } from '@speedora/contracts';
import { detectSemanticEvents } from '@speedora/semantic-events';
import { buildNarrativeGraph } from '@speedora/narrative-graph';
import type OpenAI from 'openai';
import { DEFAULT_SHORTLIST_TARGET_SIZE, selectShortlist } from './select-shortlist';

// Mocks the two seams this module orchestrates, same "mock the seam, leave
// pure functions real" convention as every render-graph node spec (e.g.
// nodes/narrative-graph.ts is exercised for real elsewhere; this file only
// cares about select-shortlist.ts's own orchestration, not
// @speedora/semantic-events'/@speedora/narrative-graph's internal LLM
// prompt behavior, which each already has its own fixture-based spec).
jest.mock('@speedora/semantic-events', () => ({
  detectSemanticEvents: jest.fn(),
}));
jest.mock('@speedora/narrative-graph', () => ({
  buildNarrativeGraph: jest.fn(),
}));

const detectSemanticEventsMock = detectSemanticEvents as jest.Mock;
const buildNarrativeGraphMock = buildNarrativeGraph as jest.Mock;

const MID_SCORES: ClipScores = {
  hookStrength: 50,
  educationalValue: 50,
  practicalValue: 50,
  curiosity: 50,
  emotion: 50,
  storytelling: 50,
  novelty: 50,
  trustAuthority: 50,
  ctaStrength: 50,
};

function candidate(overrides: Partial<ShortlistCandidateInput> = {}): ShortlistCandidateInput {
  return {
    startTime: 0,
    endTime: 30,
    scores: MID_SCORES,
    viralityScore: 50,
    segments: [{ start: 0, end: 30, text: 'a moment' }],
    ...overrides,
  };
}

const fakeOpenAI = {} as unknown as OpenAI;

describe('selectShortlist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    detectSemanticEventsMock.mockResolvedValue([]);
    buildNarrativeGraphMock.mockResolvedValue({ segments: [], relations: [], unsegmented: true });
  });

  it('passes every candidate through unchanged, with zero LLM calls, when the pool is already at or under the target', async () => {
    const candidates = Array.from({ length: 3 }, () => candidate());

    const result = await selectShortlist({ candidates, targetSize: 15 }, { openai: fakeOpenAI });

    expect(detectSemanticEventsMock).not.toHaveBeenCalled();
    expect(buildNarrativeGraphMock).not.toHaveBeenCalled();
    expect(result.shortlisted).toHaveLength(3);
    expect(result.shortlisted.map((c) => c.index).sort()).toEqual([0, 1, 2]);
    expect(result.shortlisted.every((c) => c.semanticEvents === null)).toBe(true);
    expect(result.shortlisted.every((c) => c.narrativeGraph === null)).toBe(true);
  });

  it('defaults targetSize to DEFAULT_SHORTLIST_TARGET_SIZE when omitted', async () => {
    const candidates = Array.from({ length: DEFAULT_SHORTLIST_TARGET_SIZE }, () => candidate());

    const result = await selectShortlist({ candidates }, { openai: fakeOpenAI });

    expect(detectSemanticEventsMock).not.toHaveBeenCalled();
    expect(result.shortlisted).toHaveLength(DEFAULT_SHORTLIST_TARGET_SIZE);
  });

  it('runs the two LLM calls per candidate and cuts down to targetSize, highest preRankScore first', async () => {
    const candidates = [
      candidate({ viralityScore: 90 }), // index 0 - strongest
      candidate({ viralityScore: 10 }), // index 1 - weakest
      candidate({ viralityScore: 50 }), // index 2 - middle
      candidate({ viralityScore: 50 }), // index 3 - middle
    ];

    const result = await selectShortlist({ candidates, targetSize: 2 }, { openai: fakeOpenAI });

    expect(detectSemanticEventsMock).toHaveBeenCalledTimes(4);
    expect(buildNarrativeGraphMock).toHaveBeenCalledTimes(4);
    expect(result.shortlisted).toHaveLength(2);
    expect(result.shortlisted[0].index).toBe(0);
    expect(result.shortlisted.map((c) => c.index)).not.toContain(1);
    // Sorted desc by preRankScore.
    expect(result.shortlisted[0].preRankScore).toBeGreaterThanOrEqual(
      result.shortlisted[1].preRankScore,
    );
  });

  it('re-anchors segments to candidate-relative time before calling the LLM modules', async () => {
    const candidates = Array.from({ length: 3 }, (_, i) =>
      candidate({
        startTime: 100,
        endTime: 130,
        segments: [{ start: 100, end: 130, text: `candidate ${i}` }],
      }),
    );

    await selectShortlist({ candidates, targetSize: 1 }, { openai: fakeOpenAI });

    const firstCall = detectSemanticEventsMock.mock.calls[0][0];
    expect(firstCall.segments).toEqual([{ start: 0, end: 30, text: 'candidate 0' }]);
  });

  it('degrades a candidate toward neutral (never throws) when both LLM calls fail', async () => {
    detectSemanticEventsMock.mockRejectedValue(new Error('openai is down'));
    buildNarrativeGraphMock.mockRejectedValue(new Error('openai is down'));
    const candidates = Array.from({ length: 3 }, () => candidate());

    const result = await selectShortlist({ candidates, targetSize: 2 }, { openai: fakeOpenAI });

    expect(result.shortlisted).toHaveLength(2);
    expect(result.shortlisted.every((c) => c.semanticEvents === null)).toBe(true);
    expect(result.shortlisted.every((c) => c.narrativeGraph === null)).toBe(true);
  });

  it('threads the detected semanticEvents into the narrativeGraph call as context', async () => {
    const detected = [
      { type: 'success', t: 1, confidence: 0.9, importance: 0.9, evidence: [], reason: 'x' },
    ];
    detectSemanticEventsMock.mockResolvedValue(detected);
    const candidates = Array.from({ length: 3 }, () => candidate());

    await selectShortlist({ candidates, targetSize: 1 }, { openai: fakeOpenAI });

    const call = buildNarrativeGraphMock.mock.calls[0][0];
    expect(call.semanticEvents).toEqual(detected);
  });
});
