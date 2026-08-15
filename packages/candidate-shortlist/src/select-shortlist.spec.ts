import type { ClipScores, ShortlistCandidateInput } from '@speedora/contracts';
import type { StructuredCallDeps } from '@speedora/llm-client';
import { detectSemanticEvents } from '@speedora/semantic-events';
import { buildNarrativeGraph } from '@speedora/narrative-graph';
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

// AI Intelligence v4 Phase 14.1 follow-up fix - typed via
// StructuredCallDeps['openai'] (@speedora/llm-client, already a real
// dependency of this package, resolved as a plain workspace symlink)
// rather than importing the `openai` package directly. This package never
// needs `openai` as its own dependency (deps.openai is only ever passed
// through opaquely to detectSemanticEvents/buildNarrativeGraph, both
// mocked below) - importing it just for this one test-only type caused
// `openai`'s own peer-dependency-affected resolution to make pnpm's
// injectWorkspacePackages treat this package as needing an isolated
// injected copy for ITS OWN sibling-package consumers (see
// docs/ai/clip-ranking-engine.md's Phase 14.1 CI-fix note) - a real,
// reproduced-in-CI bug, not a hypothetical one.
const fakeOpenAI = {} as unknown as StructuredCallDeps['openai'];

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

  // Editorial Director Phase A (docs/ai/editorial-director.md) - see that
  // doc for the full design. EDITORIAL_DIRECTOR_ENABLED defaults off; every
  // test above already runs with it unset, proving this phase changed
  // nothing about this module's default behavior. This block covers the
  // flag-on paths specifically.
  describe('Editorial Director Phase A wiring', () => {
    const originalEnv = process.env.EDITORIAL_DIRECTOR_ENABLED;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.EDITORIAL_DIRECTOR_ENABLED;
      } else {
        process.env.EDITORIAL_DIRECTOR_ENABLED = originalEnv;
      }
    });

    it('flag off: editorialDecision/boundaryNudge are always null, same shortlist as before this phase', async () => {
      delete process.env.EDITORIAL_DIRECTOR_ENABLED;
      const candidates = [
        candidate({ viralityScore: 90 }),
        candidate({ viralityScore: 10 }),
        candidate({ viralityScore: 50 }),
        candidate({ viralityScore: 50 }),
      ];

      const result = await selectShortlist({ candidates, targetSize: 2 }, { openai: fakeOpenAI });

      expect(result.shortlisted).toHaveLength(2);
      expect(result.shortlisted[0].index).toBe(0);
      expect(result.shortlisted.every((entry) => entry.editorialDecision === null)).toBe(true);
      expect(result.shortlisted.every((entry) => entry.boundaryNudge === null)).toBe(true);
    });

    it('flag on: prefers a lower-scored but topically distinct candidate over a redundant higher-scored one', async () => {
      process.env.EDITORIAL_DIRECTOR_ENABLED = 'true';
      detectSemanticEventsMock.mockImplementation(
        async (input: { segments: { text: string }[] }) => {
          const text = input.segments[0]?.text ?? '';
          return text.includes('billion rupiah')
            ? [{ type: 'money', t: 1, confidence: 0.9, importance: 0.8, evidence: [], reason: 'x' }]
            : [];
        },
      );

      // Distinct, NON-OVERLAPPING timestamps - true time-range overlaps are
      // deliberately excluded from redundancy consideration (handled
      // upstream by @speedora/clip-scoring's own
      // deduplicateOverlappingCandidates); this test is specifically about
      // near-duplicate TOPICS at different moments in the video.
      const candidates = [
        candidate({
          startTime: 0,
          endTime: 30,
          viralityScore: 90,
          segments: [{ start: 0, end: 30, text: 'I lost a billion rupiah in one bad trade' }],
        }),
        candidate({
          startTime: 100,
          endTime: 130,
          viralityScore: 85,
          segments: [
            { start: 100, end: 130, text: 'I lost a billion rupiah on one terrible trade' },
          ],
        }),
        candidate({
          startTime: 200,
          endTime: 230,
          viralityScore: 70,
          segments: [
            { start: 200, end: 230, text: 'a completely different story about my childhood dog' },
          ],
        }),
      ];

      const result = await selectShortlist({ candidates, targetSize: 2 }, { openai: fakeOpenAI });

      expect(result.shortlisted.map((entry) => entry.index).sort()).toEqual([0, 2]);
    });

    it('flag on: applies an in-bounds boundary nudge before returning', async () => {
      process.env.EDITORIAL_DIRECTOR_ENABLED = 'true';
      buildNarrativeGraphMock.mockResolvedValue({
        segments: [
          { id: 0, type: 'conflict', startTime: 0, endTime: 30, confidence: 0.9, reason: 'x' },
        ],
        relations: [],
        unsegmented: false,
      });
      // 4 candidates with a targetSize of 2 (< candidates.length) so this
      // actually exercises the LLM-scoring path, not selectShortlist()'s own
      // zero-LLM-call no-op passthrough (which never runs Editorial
      // Director - see the "flag off" test above, and this module's own
      // cost-scope decision in docs/ai/editorial-director.md).
      const candidates = Array.from({ length: 4 }, (_, i) =>
        candidate({
          startTime: 100 + i * 100,
          endTime: 130 + i * 100,
          segments: [
            {
              start: 100 + i * 100,
              end: 130 + i * 100,
              text: 'and that is when everything changed for us',
            },
          ],
        }),
      );

      const result = await selectShortlist({ candidates, targetSize: 2 }, { openai: fakeOpenAI });

      expect(result.shortlisted).toHaveLength(2);
      expect(result.shortlisted.every((entry) => entry.boundaryNudge?.applied)).toBe(true);
      expect(result.shortlisted[0].boundaryNudge?.suggestedStartTime).toBeLessThan(
        result.shortlisted[0].boundaryNudge!.originalStartTime,
      );
    });
  });
});
