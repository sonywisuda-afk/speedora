import {
  clipScoringCandidateSchema,
  clipScoringInputSchema,
  clipScoringOutputSchema,
} from './clip-scoring';

const VALID_CANDIDATE = {
  startTime: 5,
  endTime: 35,
  viralityScore: 82,
  hookText: 'You will not believe this',
  hashtags: ['viral', 'fyp'],
  scores: {
    hookStrength: 70,
    educationalValue: 60,
    curiosity: 65,
    emotion: 55,
    storytelling: 75,
    novelty: 50,
    trustAuthority: 80,
  },
  reason: 'Strong hook and a complete story arc.',
  topics: ['productivity'],
  keywords: ['focus', 'discipline'],
  intent: 'story',
  ctaText: '',
};

describe('clipScoringInputSchema', () => {
  it('accepts segments with and without word-level timestamps', () => {
    const result = clipScoringInputSchema.safeParse({
      segments: [
        { start: 0, end: 5, text: 'hi' },
        { start: 5, end: 10, text: 'there', words: [{ word: 'there', start: 5, end: 5.5 }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a segment missing required fields', () => {
    const result = clipScoringInputSchema.safeParse({ segments: [{ start: 0, text: 'hi' }] });
    expect(result.success).toBe(false);
  });
});

describe('clipScoringCandidateSchema', () => {
  it('accepts a fully-formed candidate', () => {
    expect(clipScoringCandidateSchema.safeParse(VALID_CANDIDATE).success).toBe(true);
  });

  it('rejects an unknown intent value', () => {
    const result = clipScoringCandidateSchema.safeParse({
      ...VALID_CANDIDATE,
      intent: 'not-a-real-intent',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a viralityScore outside 0-100', () => {
    const result = clipScoringCandidateSchema.safeParse({ ...VALID_CANDIDATE, viralityScore: 150 });
    expect(result.success).toBe(false);
  });
});

describe('clipScoringOutputSchema', () => {
  it('accepts an empty candidate list', () => {
    expect(clipScoringOutputSchema.safeParse({ candidates: [] }).success).toBe(true);
  });

  it('accepts a list of valid candidates', () => {
    expect(clipScoringOutputSchema.safeParse({ candidates: [VALID_CANDIDATE] }).success).toBe(true);
  });
});
