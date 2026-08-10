import type { SemanticEvent } from '@speedora/contracts';
import { deriveSemanticEventsScore } from './derive-semantic-events-score';

function event(overrides: Partial<SemanticEvent> = {}): SemanticEvent {
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

describe('deriveSemanticEventsScore', () => {
  it('returns a neutral midpoint (50) when events is null (the LLM call failed)', () => {
    expect(deriveSemanticEventsScore(null)).toBe(50);
  });

  it('scores a real empty detection below neutral, distinct from a failure', () => {
    expect(deriveSemanticEventsScore([])).toBe(20);
    expect(deriveSemanticEventsScore([])).toBeLessThan(deriveSemanticEventsScore(null));
  });

  it('scores the mean importance across events, scaled to [0, 100]', () => {
    expect(deriveSemanticEventsScore([event({ importance: 0.5 })])).toBe(50);
    expect(
      deriveSemanticEventsScore([event({ importance: 0.2 }), event({ importance: 0.8 })]),
    ).toBe(50);
  });

  it('stays within [0, 100] at both extremes', () => {
    expect(deriveSemanticEventsScore([event({ importance: 1 })])).toBe(100);
    expect(deriveSemanticEventsScore([event({ importance: 0 })])).toBe(0);
  });
});
