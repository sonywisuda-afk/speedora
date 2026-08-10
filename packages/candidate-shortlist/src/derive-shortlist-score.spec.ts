import type {
  ClipScores,
  NarrativeGraph,
  NarrativeSegment,
  SemanticEvent,
} from '@speedora/contracts';
import { deriveShortlistScore } from './derive-shortlist-score';

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

function segment(overrides: Partial<NarrativeSegment>): NarrativeSegment {
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

function event(overrides: Partial<SemanticEvent>): SemanticEvent {
  return {
    type: 'success',
    t: 5,
    confidence: 0.8,
    importance: 0.5,
    evidence: [],
    reason: 'because',
    ...overrides,
  };
}

describe('deriveShortlistScore', () => {
  it('returns a fully neutral score (50) when every signal is at its own midpoint/null', () => {
    const score = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: null,
      narrativeGraph: null,
    });

    expect(score).toBe(50);
  });

  it('stays within [0, 100] at both extremes', () => {
    const high = deriveShortlistScore({
      scores: {
        hookStrength: 100,
        educationalValue: 100,
        practicalValue: 100,
        curiosity: 100,
        emotion: 100,
        storytelling: 100,
        novelty: 100,
        trustAuthority: 100,
        ctaStrength: 100,
      },
      viralityScore: 100,
      semanticEvents: [event({ importance: 1 })],
      narrativeGraph: {
        segments: [segment({ type: 'resolution', confidence: 1 })],
        relations: [],
        unsegmented: false,
      },
    });
    expect(high).toBe(100);

    const low = deriveShortlistScore({
      scores: {
        hookStrength: 0,
        educationalValue: 0,
        practicalValue: 0,
        curiosity: 0,
        emotion: 0,
        storytelling: 0,
        novelty: 0,
        trustAuthority: 0,
        ctaStrength: 0,
      },
      viralityScore: 0,
      semanticEvents: [event({ importance: 0 })],
      narrativeGraph: {
        segments: [segment({ type: 'setup', confidence: 0 })],
        relations: [],
        unsegmented: false,
      },
    });
    expect(low).toBe(0);
  });

  it('scores a real detected event higher than an empty (but successful) detection', () => {
    const withEvent = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: [event({ importance: 0.9 })],
      narrativeGraph: null,
    });
    const empty = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: [],
      narrativeGraph: null,
    });

    expect(withEvent).toBeGreaterThan(empty);
  });

  it('treats a failed (null) semantic-events call as neutral, not a penalty vs. an empty result', () => {
    const failed = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: null,
      narrativeGraph: null,
    });
    const empty = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: [],
      narrativeGraph: null,
    });

    expect(failed).toBeGreaterThan(empty);
  });

  it('scores an unsegmented (but real, successful) narrative graph below neutral', () => {
    const unsegmented: NarrativeGraph = { segments: [], relations: [], unsegmented: true };
    const score = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: null,
      narrativeGraph: unsegmented,
    });

    expect(score).toBeLessThan(50);
  });

  it('rewards a segmented graph that reaches a payoff segment type over one that never does', () => {
    const withPayoff = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: null,
      narrativeGraph: {
        segments: [segment({ type: 'setup' }), segment({ id: 1, type: 'resolution' })],
        relations: [],
        unsegmented: false,
      },
    });
    const withoutPayoff = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: null,
      narrativeGraph: {
        segments: [segment({ type: 'setup' }), segment({ id: 1, type: 'conflict' })],
        relations: [],
        unsegmented: false,
      },
    });

    expect(withPayoff).toBeGreaterThan(withoutPayoff);
  });

  it('averages ALL ClipScores fields rather than a fixed subset', () => {
    const baseline = deriveShortlistScore({
      scores: MID_SCORES,
      viralityScore: 50,
      semanticEvents: null,
      narrativeGraph: null,
    });
    const higherCta = deriveShortlistScore({
      scores: { ...MID_SCORES, ctaStrength: 100 },
      viralityScore: 50,
      semanticEvents: null,
      narrativeGraph: null,
    });

    expect(higherCta).toBeGreaterThan(baseline);
  });
});
