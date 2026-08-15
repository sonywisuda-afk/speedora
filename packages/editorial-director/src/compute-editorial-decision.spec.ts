import type {
  ClipScores,
  EditingSuggestion,
  NarrativeGraph,
  NarrativeSegment,
} from '@speedora/contracts';
import {
  computeEditorialDecisionForRender,
  computeEditorialDecisionForShortlist,
  mergeNegativeSignal,
} from './compute-editorial-decision';

const SCORES: ClipScores = {
  hookStrength: 70,
  educationalValue: 60,
  practicalValue: 55,
  curiosity: 65,
  emotion: 50,
  storytelling: 60,
  novelty: 55,
  trustAuthority: 60,
  ctaStrength: 40,
};

function segment(overrides: Partial<NarrativeSegment>): NarrativeSegment {
  return {
    id: 0,
    type: 'setup',
    startTime: 0,
    endTime: 5,
    confidence: 0.9,
    reason: 'test fixture',
    ...overrides,
  };
}

function graph(segments: NarrativeSegment[]): NarrativeGraph {
  return { segments, relations: [], unsegmented: false };
}

describe('computeEditorialDecisionForShortlist', () => {
  it('produces a decision with mode shortlist and null visualEngagement/speakerClarity', () => {
    const { decision } = computeEditorialDecisionForShortlist({
      scores: SCORES,
      narrativeGraph: graph([
        segment({ type: 'setup', endTime: 5 }),
        segment({ id: 1, type: 'resolution', startTime: 5, endTime: 30 }),
      ]),
      semanticEvents: null,
      firstSegmentText: 'Here is a complete opening sentence.',
      lastSegmentText: 'And that is how it all ended.',
      fullText: 'Here is a complete opening sentence. And that is how it all ended.',
      candidateStartTime: 100,
      candidateEndTime: 130,
    });
    expect(decision.mode).toBe('shortlist');
    expect(decision.categories.visualEngagement).toBeNull();
    expect(decision.categories.speakerClarity).toBeNull();
    expect(decision.editorialScore).toBeGreaterThanOrEqual(0);
    expect(decision.editorialScore).toBeLessThanOrEqual(100);
  });

  it('returns a boundary nudge on the result when the signals agree', () => {
    const { decision, nudge } = computeEditorialDecisionForShortlist({
      scores: SCORES,
      narrativeGraph: graph([segment({ type: 'conflict' })]),
      semanticEvents: null,
      firstSegmentText: 'and that is when everything changed for us',
      lastSegmentText: 'so we finally figured it out.',
      fullText: 'and that is when everything changed for us, so we finally figured it out.',
      candidateStartTime: 100,
      candidateEndTime: 130,
    });
    expect(nudge).not.toBeNull();
    expect(decision.boundaryNudge).toEqual(nudge);
  });
});

describe('computeEditorialDecisionForRender', () => {
  it('produces a decision with mode render and populated visualEngagement/speakerClarity', () => {
    const editingSuggestions: EditingSuggestion[] = [
      { technique: 'focus_shift', start: 1, end: 2, score: 0.7, reason: 'test' },
    ];
    const decision = computeEditorialDecisionForRender({
      scores: SCORES,
      text: 'Here is a complete opening sentence. And that is how it all ended.',
      namedEntities: [],
      narrativeGraph: graph([
        segment({ type: 'setup', endTime: 5 }),
        segment({ id: 1, type: 'resolution', startTime: 5, endTime: 30 }),
      ]),
      semanticEvents: null,
      hookProbability: 75,
      topicShiftScore: 0.1,
      dropPoints: [],
      emotionalArcPeakIntensity: 0.6,
      editingSuggestions,
      clipDurationSeconds: 30,
      speakerClarityScore: 80,
    });
    expect(decision.mode).toBe('render');
    expect(decision.categories.visualEngagement).not.toBeNull();
    expect(decision.categories.speakerClarity).toBe(80);
    expect(decision.boundaryNudge).toBeNull();
  });

  it('never crashes on fully-null/empty optional inputs', () => {
    const decision = computeEditorialDecisionForRender({
      scores: SCORES,
      text: '',
      namedEntities: [],
      narrativeGraph: null,
      semanticEvents: null,
      hookProbability: null,
      topicShiftScore: null,
      dropPoints: [],
      emotionalArcPeakIntensity: null,
      editingSuggestions: [],
      clipDurationSeconds: 30,
      speakerClarityScore: null,
    });
    expect(decision.editorialScore).toBeGreaterThanOrEqual(0);
  });
});

describe('mergeNegativeSignal', () => {
  it('folds in an additional signal and recomposes editorialScore downward', () => {
    const { decision } = computeEditorialDecisionForShortlist({
      scores: SCORES,
      narrativeGraph: null,
      semanticEvents: null,
      firstSegmentText: 'Here is a complete opening sentence.',
      lastSegmentText: 'And that is how it all ended.',
      fullText: 'Here is a complete opening sentence. And that is how it all ended.',
      candidateStartTime: 100,
      candidateEndTime: 130,
    });

    const merged = mergeNegativeSignal(decision, {
      type: 'redundancy',
      penalty: 20,
      reason: 'near-duplicate of another candidate',
    });

    expect(merged.negativeSignals.some((signal) => signal.type === 'redundancy')).toBe(true);
    expect(merged.editorialScore).toBeLessThanOrEqual(decision.editorialScore);
  });

  it('replaces an existing signal of the same type rather than duplicating it', () => {
    const { decision } = computeEditorialDecisionForShortlist({
      scores: SCORES,
      narrativeGraph: null,
      semanticEvents: null,
      firstSegmentText: 'Here is a complete opening sentence.',
      lastSegmentText: 'And that is how it all ended.',
      fullText: 'Here is a complete opening sentence. And that is how it all ended.',
      candidateStartTime: 100,
      candidateEndTime: 130,
    });
    const once = mergeNegativeSignal(decision, { type: 'redundancy', penalty: 10, reason: 'a' });
    const twice = mergeNegativeSignal(once, { type: 'redundancy', penalty: 20, reason: 'b' });
    expect(twice.negativeSignals.filter((signal) => signal.type === 'redundancy')).toHaveLength(1);
  });
});
