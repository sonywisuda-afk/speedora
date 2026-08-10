import type { ClipScoringSegment } from '@speedora/contracts';
import type OpenAI from 'openai';
import { filterOverlappingCandidates, scoreClipCandidates } from './score-clip-candidates';

// Pure fixture-based tests - no DB/queue/Sentry mocking at all, since the
// module never touches any of that (see root ARCHITECTURE.md). Only the LLM
// call itself is faked, via the injected deps.openai.
function fakeOpenAI(candidates: unknown[]): OpenAI {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ candidates }) } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const FULL_SCORES = {
  hookStrength: 70,
  educationalValue: 60,
  practicalValue: 65,
  curiosity: 65,
  emotion: 55,
  storytelling: 75,
  novelty: 50,
  trustAuthority: 80,
  ctaStrength: 40,
};

// Every field the module's response schema requires, with sensible defaults -
// tests override only what they care about instead of repeating all 11 fields.
function rawCandidate(overrides: Record<string, unknown>) {
  return {
    hashtags: [],
    scores: FULL_SCORES,
    reason: 'because it is a strong self-contained moment',
    topics: ['topic-a'],
    keywords: ['keyword-a'],
    intent: 'educate',
    ctaText: '',
    ...overrides,
  };
}

describe('scoreClipCandidates', () => {
  it('returns no candidates and skips the LLM call when there are no segments', async () => {
    const openai = fakeOpenAI([]);

    const result = await scoreClipCandidates({ segments: [] }, { openai });

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: [] });
  });

  it('drops out-of-range, inverted, and too-short clips, clamps score, sorts, and caps at 3', async () => {
    const segments: ClipScoringSegment[] = [
      { start: 0, end: 5, text: 'intro' },
      { start: 5, end: 60, text: 'main content' },
    ];
    const openai = fakeOpenAI([
      rawCandidate({ startTime: 10, endTime: 35, viralityScore: 150, hookText: 'a' }), // 25s, score clamped to 100
      rawCandidate({ startTime: 0, endTime: 22, viralityScore: 40, hookText: 'b' }), // 22s
      rawCandidate({ startTime: 30, endTime: 25, viralityScore: 90, hookText: 'c' }), // invalid: end <= start, dropped
      rawCandidate({ startTime: -5, endTime: 20, viralityScore: 80, hookText: 'd' }), // out of range, dropped
      rawCandidate({ startTime: 40, endTime: 50, viralityScore: 95, hookText: 'x' }), // 10s < 20s min, dropped
      rawCandidate({ startTime: 35, endTime: 58, viralityScore: 70, hookText: 'e' }), // 23s
      rawCandidate({ startTime: 30, endTime: 55, viralityScore: 60, hookText: 'f' }), // 25s, 4th valid -> cut by MAX_CANDIDATES
    ]);

    const result = await scoreClipCandidates({ segments }, { openai });

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(3);
    // 4 candidates survive the range/length/order filter (100, 40, 70, 60);
    // the 10s/score-95 one is dropped for being under the 20s minimum (it
    // would otherwise top the list), then sorted desc and capped at 3 drops
    // the lowest survivor (40).
    expect(result.candidates.map((c) => c.viralityScore)).toEqual([100, 70, 60]);
  });

  it('allows a whole-video clip shorter than the 20s minimum when the source itself is that short', async () => {
    // A 10s source: the effective minimum is clamped to its duration, so its
    // single full-length candidate isn't rejected for being under 20s.
    const segments: ClipScoringSegment[] = [{ start: 0, end: 10, text: 'short talk' }];
    const openai = fakeOpenAI([
      rawCandidate({ startTime: 0, endTime: 10, viralityScore: 80, hookText: 'hook' }),
    ]);

    const result = await scoreClipCandidates({ segments }, { openai });

    expect(result.candidates).toHaveLength(1);
  });

  it('falls back to a single whole-video clip when the model returns only too-short fragments', async () => {
    // A 60s source (min 20s) where the model only returned short fragments -
    // rather than leaving 0 candidates, one candidate spanning the whole
    // transcript is emitted, reusing the best fragment's hook/hashtags/score.
    const segments: ClipScoringSegment[] = [
      { start: 0, end: 30, text: 'first half' },
      { start: 30, end: 60, text: 'second half' },
    ];
    const openai = fakeOpenAI([
      rawCandidate({
        startTime: 5,
        endTime: 12,
        viralityScore: 60,
        hookText: 'weak hook',
        hashtags: ['a'],
      }),
      rawCandidate({
        startTime: 20,
        endTime: 28,
        viralityScore: 88,
        hookText: 'best hook',
        hashtags: ['b'],
      }),
    ]);

    const result = await scoreClipCandidates({ segments }, { openai });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      startTime: 0,
      endTime: 60,
      viralityScore: 88,
      hookText: 'best hook',
      hashtags: ['b'],
    });
  });

  it('trims hookText and sanitizes hashtags (stray "#" and blanks)', async () => {
    const segments: ClipScoringSegment[] = [{ start: 0, end: 10, text: 'hi' }];
    const openai = fakeOpenAI([
      rawCandidate({
        startTime: 0,
        endTime: 10,
        viralityScore: 80,
        hookText: '  You wont believe this  ',
        hashtags: ['#viral', ' fyp ', '#foryou', '', '  '],
      }),
    ]);

    const result = await scoreClipCandidates({ segments }, { openai });

    expect(result.candidates[0].hookText).toBe('You wont believe this');
    expect(result.candidates[0].hashtags).toEqual(['viral', 'fyp', 'foryou']);
  });

  it('clamps each score metric to 0-100 and sanitizes reason/topics/keywords', async () => {
    const segments: ClipScoringSegment[] = [{ start: 0, end: 10, text: 'hi' }];
    const openai = fakeOpenAI([
      rawCandidate({
        startTime: 0,
        endTime: 10,
        viralityScore: 80,
        hookText: 'hook',
        scores: {
          hookStrength: 150, // clamped to 100
          educationalValue: -20, // clamped to 0
          practicalValue: 65,
          curiosity: 65,
          emotion: 55,
          storytelling: 75,
          novelty: 50,
          trustAuthority: 80,
          ctaStrength: 40,
        },
        reason: '  Explains a clear before/after transformation.  ',
        topics: [' productivity ', '', 'habits'],
        keywords: ['  focus  ', '', 'discipline'],
        intent: 'persuade',
        ctaText: 'follow for part 2',
      }),
    ]);

    const result = await scoreClipCandidates({ segments }, { openai });

    expect(result.candidates[0].scores).toMatchObject({ hookStrength: 100, educationalValue: 0 });
    expect(result.candidates[0].reason).toBe('Explains a clear before/after transformation.');
    expect(result.candidates[0].topics).toEqual(['productivity', 'habits']);
    expect(result.candidates[0].keywords).toEqual(['focus', 'discipline']);
    expect(result.candidates[0].intent).toBe('persuade');
    expect(result.candidates[0].ctaText).toBe('follow for part 2');
  });

  describe('Smart Start/End (word-boundary snapping)', () => {
    it('snaps startTime/endTime to the nearest actual word instead of the raw LLM seconds', async () => {
      // The LLM's candidate (4.2 - 25.5, a valid 21.3s length) lands mid-word
      // at both ends: 4.2 is inside "waiting" (4-4.6), 25.5 is inside
      // "moment" (25-25.9).
      const segments: ClipScoringSegment[] = [
        {
          start: 0,
          end: 60,
          text: 'Stop waiting for the perfect moment. Just start.',
          words: [
            { word: 'Stop', start: 0, end: 0.5 },
            { word: 'waiting', start: 4, end: 4.6 },
            { word: 'for', start: 4.6, end: 4.9 },
            { word: 'the', start: 4.9, end: 5.1 },
            { word: 'perfect', start: 5.1, end: 5.8 },
            { word: 'moment', start: 25, end: 25.9 },
            { word: 'Just', start: 35, end: 35.3 },
            { word: 'start', start: 35.3, end: 35.9 },
          ],
        },
      ];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 4.2, endTime: 25.5, viralityScore: 90, hookText: 'hook' }),
      ]);

      const result = await scoreClipCandidates({ segments }, { openai });

      // Snapped out to the containing word's own boundaries: "waiting"
      // starts at 4, "moment" ends at 25.9.
      expect(result.candidates[0].startTime).toBe(4);
      expect(result.candidates[0].endTime).toBe(25.9);
    });

    it('snaps a boundary that falls in a silence gap to the nearest word edge, trimming lead-in/trailing silence', async () => {
      const segments: ClipScoringSegment[] = [
        {
          start: 0,
          end: 60,
          text: 'Here is the story. The end.',
          words: [
            { word: 'Here', start: 10, end: 10.4 },
            { word: 'is', start: 10.4, end: 10.6 },
            { word: 'the', start: 10.6, end: 10.8 },
            { word: 'story', start: 10.8, end: 11.5 },
            { word: 'The', start: 30, end: 30.3 },
            { word: 'end', start: 30.3, end: 30.8 },
          ],
        },
      ];
      const openai = fakeOpenAI([
        // 8 falls in silence before "Here" (10) - should snap forward to 10.
        // 32 falls in silence after "end" (30.8) - should snap back to 30.8.
        rawCandidate({ startTime: 8, endTime: 32, viralityScore: 90, hookText: 'hook' }),
      ]);

      const result = await scoreClipCandidates({ segments }, { openai });

      expect(result.candidates[0].startTime).toBe(10);
      expect(result.candidates[0].endTime).toBe(30.8);
    });

    it('leaves startTime/endTime unchanged when no segment has word-level data', async () => {
      const segments: ClipScoringSegment[] = [
        { start: 0, end: 60, text: 'No word timestamps on this video.' },
      ];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 5.234, endTime: 30.876, viralityScore: 90, hookText: 'hook' }),
      ]);

      const result = await scoreClipCandidates({ segments }, { openai });

      expect(result.candidates[0].startTime).toBe(5.234);
      expect(result.candidates[0].endTime).toBe(30.876);
    });
  });

  // Pre-Processing Settings roadmap (Phase 0/1) - maxCandidates/minClipSeconds/
  // maxClipSeconds overrides, threaded through from Video.processingOptions.
  describe('processing-options overrides', () => {
    it('caps at maxCandidates instead of the module default when provided', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 200, text: 'long video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 0, endTime: 30, viralityScore: 90, hookText: 'a' }),
        rawCandidate({ startTime: 30, endTime: 60, viralityScore: 80, hookText: 'b' }),
        rawCandidate({ startTime: 60, endTime: 90, viralityScore: 70, hookText: 'c' }),
        rawCandidate({ startTime: 90, endTime: 120, viralityScore: 60, hookText: 'd' }),
        rawCandidate({ startTime: 120, endTime: 150, viralityScore: 50, hookText: 'e' }),
      ]);

      const result = await scoreClipCandidates({ segments, maxCandidates: 5 }, { openai });

      expect(result.candidates).toHaveLength(5);
    });

    it('allows a shorter minClipSeconds than the module default', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 60, text: 'video' }];
      const openai = fakeOpenAI([
        // 8s - under the module's own 20s default, but above a 5s override.
        rawCandidate({ startTime: 0, endTime: 8, viralityScore: 90, hookText: 'a' }),
      ]);

      const result = await scoreClipCandidates({ segments, minClipSeconds: 5 }, { openai });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ startTime: 0, endTime: 8 });
    });

    it('tells the model a shorter maxClipSeconds in the prompt when provided', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 60, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 0, endTime: 30, viralityScore: 90, hookText: 'a' }),
      ]);

      await scoreClipCandidates({ segments, maxClipSeconds: 45 }, { openai });

      const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
      const systemMessage = call.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('45 seconds long');
    });

    // AI Intelligence v4 Phase 13.1 (Clip Ranking Engine, see
    // docs/ai/clip-ranking-engine.md) - the real bug fix: the prompt used to
    // hardcode "Pick 1-3 non-overlapping clips" regardless of maxCandidates,
    // so raising the cap had no effect on what the model was actually asked
    // for. These two tests lock in that the prompt text now tracks the real
    // value in both directions.
    it('tells the model the real maxCandidates ceiling in the prompt when raised', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 600, text: 'long video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 0, endTime: 30, viralityScore: 90, hookText: 'a' }),
      ]);

      await scoreClipCandidates({ segments, maxCandidates: 30 }, { openai });

      const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
      const systemMessage = call.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('Pick between 1 and 30 non-overlapping clips');
      expect(systemMessage.content).not.toContain('Pick 1-3');
    });

    it('keeps the module default of 3 in the prompt when maxCandidates is omitted', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 60, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 0, endTime: 30, viralityScore: 90, hookText: 'a' }),
      ]);

      await scoreClipCandidates({ segments }, { openai });

      const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
      const systemMessage = call.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('Pick between 1 and 3 non-overlapping clips');
    });

    // Pre-Processing Settings roadmap (Phase 2).
    it('filters out candidates below minConfidence before the length/cap filters', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 120, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 0, endTime: 30, viralityScore: 80, hookText: 'a' }),
        rawCandidate({ startTime: 30, endTime: 60, viralityScore: 40, hookText: 'b' }),
      ]);

      const result = await scoreClipCandidates({ segments, minConfidence: 60 }, { openai });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].viralityScore).toBe(80);
    });

    it('falls back to the whole-video clip rather than zero candidates when minConfidence excludes everything', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 60, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 0, endTime: 30, viralityScore: 20, hookText: 'a' }),
      ]);

      const result = await scoreClipCandidates({ segments, minConfidence: 90 }, { openai });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ startTime: 0, endTime: 60 });
    });

    it('reorders preferred-intent candidates ahead of others before the maxCandidates cap, without dropping non-preferred ones that still fit', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 120, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({
          startTime: 0,
          endTime: 30,
          viralityScore: 90,
          hookText: 'a',
          intent: 'entertain',
        }),
        rawCandidate({
          startTime: 30,
          endTime: 60,
          viralityScore: 50,
          hookText: 'b',
          intent: 'educate',
        }),
      ]);

      const result = await scoreClipCandidates(
        { segments, maxCandidates: 5, preferredIntents: ['educate'] },
        { openai },
      );

      // Both fit under the cap (5) - preferredIntents reorders but doesn't drop.
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0].hookText).toBe('b');
      expect(result.candidates[1].hookText).toBe('a');
    });

    it('drops a lower-priority candidate over a preferred-intent one when the cap forces a choice', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 120, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({
          startTime: 0,
          endTime: 30,
          viralityScore: 90,
          hookText: 'high-score-other-intent',
          intent: 'entertain',
        }),
        rawCandidate({
          startTime: 30,
          endTime: 60,
          viralityScore: 40,
          hookText: 'low-score-preferred-intent',
          intent: 'educate',
        }),
      ]);

      const result = await scoreClipCandidates(
        { segments, maxCandidates: 1, preferredIntents: ['educate'] },
        { openai },
      );

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].hookText).toBe('low-score-preferred-intent');
    });
  });

  // Generate More Clips roadmap (Phase C) - excludeRanges is a prompt hint
  // only (see filterOverlappingCandidates below for the authoritative,
  // code-enforced check); this just confirms the hint reaches the prompt.
  describe('excludeRanges', () => {
    it('does not mention exclusions in the prompt when excludeRanges is omitted or empty', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 60, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 0, endTime: 30, viralityScore: 90, hookText: 'a' }),
      ]);

      await scoreClipCandidates({ segments, excludeRanges: [] }, { openai });

      const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
      const systemMessage = call.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).not.toContain('MUST be avoided');
    });

    it('tells the model which time ranges to avoid when excludeRanges is provided', async () => {
      const segments: ClipScoringSegment[] = [{ start: 0, end: 60, text: 'video' }];
      const openai = fakeOpenAI([
        rawCandidate({ startTime: 30, endTime: 60, viralityScore: 90, hookText: 'a' }),
      ]);

      await scoreClipCandidates({ segments, excludeRanges: [{ start: 0, end: 20 }] }, { openai });

      const call = (openai.chat.completions.create as jest.Mock).mock.calls[0][0];
      const systemMessage = call.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('MUST be avoided');
      expect(systemMessage.content).toContain('0.0-20.0');
    });
  });
});

describe('filterOverlappingCandidates', () => {
  function candidate(startTime: number, endTime: number) {
    return { startTime, endTime };
  }

  it('returns every candidate unchanged when excludeRanges is empty', () => {
    const candidates = [candidate(0, 10), candidate(20, 30)];

    expect(filterOverlappingCandidates(candidates, [])).toEqual(candidates);
  });

  it('drops a candidate that exactly matches an excluded range', () => {
    const candidates = [candidate(10, 20)];

    expect(filterOverlappingCandidates(candidates, [{ start: 10, end: 20 }])).toEqual([]);
  });

  it('drops a candidate that partially overlaps an excluded range', () => {
    const candidates = [candidate(15, 25)];

    expect(filterOverlappingCandidates(candidates, [{ start: 10, end: 20 }])).toEqual([]);
  });

  it('drops a candidate fully contained inside an excluded range, and one that fully contains it', () => {
    const contained = candidate(12, 18);
    const containing = candidate(5, 25);

    expect(filterOverlappingCandidates([contained], [{ start: 10, end: 20 }])).toEqual([]);
    expect(filterOverlappingCandidates([containing], [{ start: 10, end: 20 }])).toEqual([]);
  });

  it('keeps a candidate that only touches an excluded range at the boundary (no overlap)', () => {
    const candidates = [candidate(20, 30)];

    expect(filterOverlappingCandidates(candidates, [{ start: 10, end: 20 }])).toEqual(candidates);
  });

  it('keeps a candidate clear of every excluded range and drops only the overlapping one', () => {
    const clear = candidate(30, 40);
    const overlapping = candidate(5, 15);

    const result = filterOverlappingCandidates(
      [clear, overlapping],
      [
        { start: 0, end: 10 },
        { start: 50, end: 60 },
      ],
    );

    expect(result).toEqual([clear]);
  });
});
