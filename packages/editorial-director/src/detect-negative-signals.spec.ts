import type {
  EditingSuggestion,
  NarrativeGraph,
  NarrativeSegment,
  RetentionPoint,
} from '@speedora/contracts';
import {
  detectAbruptEnding,
  detectConfusion,
  detectDeadAir,
  detectIncompleteThought,
  detectOverEditingRisk,
  detectPayoffMissing,
  detectSetupTooLong,
  detectVisualInstability,
} from './detect-negative-signals';

function segment(overrides: Partial<NarrativeSegment>): NarrativeSegment {
  return {
    id: 0,
    type: 'setup',
    startTime: 0,
    endTime: 1,
    confidence: 0.9,
    reason: 'test fixture',
    ...overrides,
  };
}

function graph(
  segments: NarrativeSegment[],
  relations: NarrativeGraph['relations'] = [],
): NarrativeGraph {
  return { segments, relations, unsegmented: false };
}

const UNSEGMENTED: NarrativeGraph = { segments: [], relations: [], unsegmented: true };

function suggestion(overrides: Partial<EditingSuggestion>): EditingSuggestion {
  return { technique: 'focus_shift', start: 0, end: 1, score: 0.5, reason: 'test', ...overrides };
}

describe('detectDeadAir', () => {
  it('returns 0 in render mode with no drop points', () => {
    expect(detectDeadAir(null, null, []).penalty).toBe(0);
  });

  it('penalizes proportional to drop severity in render mode', () => {
    const dropPoints: RetentionPoint[] = [{ t: 5, score: 0.8 }];
    const result = detectDeadAir(null, null, dropPoints);
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('applies a flat proxy penalty in shortlist mode when unsegmented', () => {
    const result = detectDeadAir(UNSEGMENTED, 2, null);
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('applies no proxy penalty in shortlist mode with a real structure and events', () => {
    const result = detectDeadAir(graph([segment({})]), 3, null);
    expect(result.penalty).toBe(0);
  });
});

describe('detectConfusion', () => {
  it('returns 0 with no narrativeGraph and no topicShiftScore', () => {
    expect(detectConfusion(null, null).penalty).toBe(0);
  });

  it('penalizes low segment confidence', () => {
    const result = detectConfusion(graph([segment({ confidence: 0.2 })]), null);
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('penalizes high topic shift score in render mode', () => {
    const result = detectConfusion(null, 0.9);
    expect(result.penalty).toBeGreaterThan(0);
  });
});

describe('detectIncompleteThought', () => {
  it('returns 0 with no narrativeGraph', () => {
    expect(detectIncompleteThought(null).penalty).toBe(0);
  });

  it('penalizes unresolved conflict/escalation with no resolves relation', () => {
    const result = detectIncompleteThought(graph([segment({ id: 0, type: 'conflict' })]));
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('does not penalize when a resolves relation closes the tension', () => {
    const result = detectIncompleteThought(
      graph(
        [segment({ id: 0, type: 'conflict' }), segment({ id: 1, type: 'resolution' })],
        [{ fromSegmentId: 1, toSegmentId: 0, type: 'resolves' }],
      ),
    );
    expect(result.penalty).toBe(0);
  });
});

describe('detectAbruptEnding', () => {
  it('returns 0 with no narrativeGraph', () => {
    expect(detectAbruptEnding(null, 30).penalty).toBe(0);
  });

  it('penalizes ending mid-non-payoff-segment near the clip boundary', () => {
    const result = detectAbruptEnding(
      graph([segment({ type: 'conflict', startTime: 25, endTime: 30 })]),
      30,
    );
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('does not penalize ending on a payoff-bearing segment', () => {
    const result = detectAbruptEnding(
      graph([segment({ type: 'resolution', startTime: 25, endTime: 30 })]),
      30,
    );
    expect(result.penalty).toBe(0);
  });

  it('does not penalize when the last segment ends well before the clip boundary', () => {
    const result = detectAbruptEnding(
      graph([segment({ type: 'conflict', startTime: 5, endTime: 10 })]),
      30,
    );
    expect(result.penalty).toBe(0);
  });
});

describe('detectSetupTooLong', () => {
  it('returns 0 with no narrativeGraph', () => {
    expect(detectSetupTooLong(null, 30).penalty).toBe(0);
  });

  it('does not penalize a short setup', () => {
    const result = detectSetupTooLong(
      graph([
        segment({ id: 0, type: 'setup', startTime: 0, endTime: 3 }),
        segment({ id: 1, type: 'peak', startTime: 3, endTime: 30 }),
      ]),
      30,
    );
    expect(result.penalty).toBe(0);
  });

  it('penalizes a setup occupying most of the clip', () => {
    const result = detectSetupTooLong(
      graph([
        segment({ id: 0, type: 'setup', startTime: 0, endTime: 20 }),
        segment({ id: 1, type: 'peak', startTime: 20, endTime: 30 }),
      ]),
      30,
    );
    expect(result.penalty).toBeGreaterThan(0);
  });
});

describe('detectPayoffMissing', () => {
  it('returns 0 with no narrativeGraph', () => {
    expect(detectPayoffMissing(null).penalty).toBe(0);
  });

  it('penalizes when no payoff-type segment or resolves relation exists', () => {
    const result = detectPayoffMissing(
      graph([segment({ type: 'setup' }), segment({ id: 1, type: 'conflict' })]),
    );
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('does not penalize when a takeaway segment exists', () => {
    const result = detectPayoffMissing(graph([segment({ type: 'takeaway' })]));
    expect(result.penalty).toBe(0);
  });
});

describe('detectVisualInstability', () => {
  it('returns 0 with fewer than 2 crop-moving suggestions', () => {
    expect(detectVisualInstability([suggestion({ technique: 'focus_shift' })]).penalty).toBe(0);
  });

  it('penalizes clustered crop-moving suggestions', () => {
    const result = detectVisualInstability([
      suggestion({ technique: 'focus_shift', start: 1, end: 2 }),
      suggestion({ technique: 'digital_push', start: 2.2, end: 3 }),
    ]);
    expect(result.penalty).toBeGreaterThan(0);
  });

  it('does not penalize well-spaced crop-moving suggestions', () => {
    const result = detectVisualInstability([
      suggestion({ technique: 'focus_shift', start: 1, end: 2 }),
      suggestion({ technique: 'digital_push', start: 20, end: 21 }),
    ]);
    expect(result.penalty).toBe(0);
  });

  it('ignores non-crop-moving techniques like ocr_highlight', () => {
    const result = detectVisualInstability([
      suggestion({ technique: 'ocr_highlight', start: 1, end: 2 }),
      suggestion({ technique: 'ocr_highlight', start: 2.1, end: 3 }),
    ]);
    expect(result.penalty).toBe(0);
  });
});

describe('detectOverEditingRisk', () => {
  it('returns 0 for a reasonable suggestion density', () => {
    const suggestions = [suggestion({ start: 0, end: 1 })];
    expect(detectOverEditingRisk(suggestions, 60).penalty).toBe(0);
  });

  it('penalizes an excessive suggestion density', () => {
    const suggestions = Array.from({ length: 20 }, (_, i) =>
      suggestion({ start: i, end: i + 0.5 }),
    );
    const result = detectOverEditingRisk(suggestions, 60);
    expect(result.penalty).toBeGreaterThan(0);
  });
});
