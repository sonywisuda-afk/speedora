import type { ClipScoringSegment } from '@speedora/contracts';
import type OpenAI from 'openai';
import { scoreClipCandidates } from './score-clip-candidates';

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
});
