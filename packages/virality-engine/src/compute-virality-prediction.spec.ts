import type {
  ComputeViralityPredictionInput,
  EmotionalArcSample,
  HookPredictionOutput,
  MomentumSample,
  NarrativeGraph,
} from '@speedora/contracts';
import { computeViralityPrediction } from './compute-virality-prediction';

function baseInput(
  overrides: Partial<ComputeViralityPredictionInput> = {},
): ComputeViralityPredictionInput {
  return {
    clipId: 'clip-1',
    hookPrediction: null,
    narrativeGraph: null,
    momentumCurve: [],
    emotionalArc: [],
    ...overrides,
  };
}

function hookPrediction(
  hookProbability: number,
  expectedReplayPotential: number,
): HookPredictionOutput {
  return {
    clipId: 'clip-1',
    hookProbability,
    reason: 'test',
    confidence: 0.9,
    linguisticFeatures: {
      sentiment: 'neutral',
      dominantEmotion: 'neutral',
      surpriseScore: 0.5,
      controversyScore: 0.5,
      keywordRarityScore: 0.5,
      topicShiftScore: 0.5,
      questionDensity: 0.5,
      numericFactCount: 0,
      namedEntities: [],
    },
    predictionFeatures: {
      expectedScrollStopRate: 0.5,
      expectedRetentionLift: 0,
      expectedReplayPotential,
    },
  };
}

function momentum(t: number, momentumScore: number): MomentumSample {
  return { t, momentumScore };
}

function emotion(t: number, intensity: number): EmotionalArcSample {
  return { t, emotion: 'hap', intensity };
}

function narrativeGraphWith(
  segmentTypes: NarrativeGraph['segments'][number]['type'][],
  relations: NarrativeGraph['relations'] = [],
): NarrativeGraph {
  return {
    segments: segmentTypes.map((type, index) => ({
      id: index,
      type,
      startTime: index,
      endTime: index + 1,
      confidence: 0.9,
      reason: 'test',
    })),
    relations,
    unsegmented: false,
  };
}

describe('computeViralityPrediction', () => {
  it('returns every sub-probability null, viralityProbability null, confidence 0 when all inputs are null/empty', () => {
    const result = computeViralityPrediction(baseInput());

    expect(result.clipId).toBe('clip-1');
    expect(result.viralityProbability).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.subProbabilities).toEqual({
      hookStrength: null,
      replayPotential: null,
      buildIntensity: null,
      peakMomentum: null,
      emotionalIntensity: null,
      emotionalRange: null,
      narrativeCompleteness: null,
      payoffPresence: null,
    });
    expect(result.reason).toBe('Not enough signals were available to estimate virality potential.');
  });

  it('does not throw for any combination of null/empty inputs', () => {
    expect(() => computeViralityPrediction(baseInput())).not.toThrow();
    expect(() =>
      computeViralityPrediction(baseInput({ momentumCurve: [momentum(0, 0.5)] })),
    ).not.toThrow();
    expect(() =>
      computeViralityPrediction(
        baseInput({ narrativeGraph: { segments: [], relations: [], unsegmented: true } }),
      ),
    ).not.toThrow();
  });

  // Regression test: an earlier version used `narrativeGraph !== null` (a
  // strict check), which threw when the render-graph's own `get()` handed
  // back `undefined` rather than `null` for a not-yet-resolved/mocked dep
  // (caught by render-clip.worker.spec.ts's real integration fixtures).
  // Same `narrativeGraph != null` (loose, catches both) fix
  // @speedora/contextual-momentum's segmentAt() already uses.
  it('does not throw when narrativeGraph is undefined rather than null', () => {
    const input = { ...baseInput(), narrativeGraph: undefined } as unknown as ReturnType<
      typeof baseInput
    >;
    expect(() => computeViralityPrediction(input)).not.toThrow();
    const result = computeViralityPrediction(input);
    expect(result.subProbabilities.narrativeCompleteness).toBeNull();
    expect(result.subProbabilities.payoffPresence).toBeNull();
  });

  describe('hookStrength / replayPotential (Phase 1)', () => {
    it('derives hookStrength as hookProbability / 100', () => {
      const result = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction(80, 0.3) }),
      );
      expect(result.subProbabilities.hookStrength).toBeCloseTo(0.8, 5);
    });

    it('passes replayPotential through directly from predictionFeatures', () => {
      const result = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction(80, 0.3) }),
      );
      expect(result.subProbabilities.replayPotential).toBeCloseTo(0.3, 5);
    });

    it('are both null when hookPrediction is null', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.hookStrength).toBeNull();
      expect(result.subProbabilities.replayPotential).toBeNull();
    });
  });

  describe('buildIntensity / peakMomentum (Phase 4)', () => {
    it('is null when momentumCurve has fewer than 2 samples', () => {
      const result = computeViralityPrediction(baseInput({ momentumCurve: [momentum(0, 0.5)] }));
      expect(result.subProbabilities.buildIntensity).toBeNull();
      // peakMomentum only needs 1 sample.
      expect(result.subProbabilities.peakMomentum).toBeCloseTo(0.5, 5);
    });

    it('is null (both) when momentumCurve is empty', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.buildIntensity).toBeNull();
      expect(result.subProbabilities.peakMomentum).toBeNull();
    });

    it('rises above neutral (0.5) when the second half builds on the first', () => {
      const momentumCurve = [
        momentum(0, 0.1),
        momentum(1, 0.1),
        momentum(2, 0.9),
        momentum(3, 0.9),
      ];
      const result = computeViralityPrediction(baseInput({ momentumCurve }));
      expect(result.subProbabilities.buildIntensity).toBeGreaterThan(0.5);
    });

    it('falls below neutral (0.5) when the second half fades from the first', () => {
      const momentumCurve = [
        momentum(0, 0.9),
        momentum(1, 0.9),
        momentum(2, 0.1),
        momentum(3, 0.1),
      ];
      const result = computeViralityPrediction(baseInput({ momentumCurve }));
      expect(result.subProbabilities.buildIntensity).toBeLessThan(0.5);
    });

    it('finds the max momentumScore for peakMomentum', () => {
      const momentumCurve = [momentum(0, 0.2), momentum(1, 0.9), momentum(2, 0.4)];
      const result = computeViralityPrediction(baseInput({ momentumCurve }));
      expect(result.subProbabilities.peakMomentum).toBeCloseTo(0.9, 5);
    });
  });

  describe('emotionalIntensity / emotionalRange (Phase 5)', () => {
    it('is null (both) when emotionalArc is empty', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.emotionalIntensity).toBeNull();
      expect(result.subProbabilities.emotionalRange).toBeNull();
    });

    it('averages intensity across the arc', () => {
      const emotionalArc = [emotion(0, 0.2), emotion(1, 0.4), emotion(2, 0.6)];
      const result = computeViralityPrediction(baseInput({ emotionalArc }));
      expect(result.subProbabilities.emotionalIntensity).toBeCloseTo(0.4, 5);
    });

    it('computes emotionalRange as max minus min intensity', () => {
      const emotionalArc = [emotion(0, 0.2), emotion(1, 0.9), emotion(2, 0.5)];
      const result = computeViralityPrediction(baseInput({ emotionalArc }));
      expect(result.subProbabilities.emotionalRange).toBeCloseTo(0.7, 5);
    });

    it('is 0 emotionalRange for a single sample (a real value, not null)', () => {
      const result = computeViralityPrediction(baseInput({ emotionalArc: [emotion(0, 0.5)] }));
      expect(result.subProbabilities.emotionalRange).toBe(0);
    });
  });

  describe('narrativeCompleteness / payoffPresence (Phase 3)', () => {
    it('is null (both) when narrativeGraph is null', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.narrativeCompleteness).toBeNull();
      expect(result.subProbabilities.payoffPresence).toBeNull();
    });

    it('is null (both) when narrativeGraph is unsegmented', () => {
      const result = computeViralityPrediction(
        baseInput({ narrativeGraph: { segments: [], relations: [], unsegmented: true } }),
      );
      expect(result.subProbabilities.narrativeCompleteness).toBeNull();
      expect(result.subProbabilities.payoffPresence).toBeNull();
    });

    it('computes narrativeCompleteness as distinct segment types / 10', () => {
      const narrativeGraph = narrativeGraphWith(['hook', 'setup', 'peak']);
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.narrativeCompleteness).toBeCloseTo(0.3, 5);
    });

    it('gives payoffPresence 1 when a resolves relation exists', () => {
      const narrativeGraph = narrativeGraphWith(
        ['problem', 'resolution'],
        [{ fromSegmentId: 1, toSegmentId: 0, type: 'resolves' }],
      );
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.payoffPresence).toBe(1);
    });

    it('gives payoffPresence 0.5 when a payoff-type segment exists without a resolves relation', () => {
      const narrativeGraph = narrativeGraphWith(['problem', 'takeaway']);
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.payoffPresence).toBe(0.5);
    });

    it('gives payoffPresence 0 when no payoff-type segment or resolves relation exists', () => {
      const narrativeGraph = narrativeGraphWith(['hook', 'setup']);
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.payoffPresence).toBe(0);
    });
  });

  describe('composite viralityProbability / confidence', () => {
    it('averages only the non-null sub-probabilities (partial coverage)', () => {
      const result = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction(100, 1) }),
      );
      // hookStrength=1, replayPotential=1, everything else null -> avg = 1.
      expect(result.subProbabilities.hookStrength).toBe(1);
      expect(result.subProbabilities.replayPotential).toBe(1);
      expect(result.viralityProbability).toBeCloseTo(1, 5);
      expect(result.confidence).toBeCloseTo(2 / 8, 5);
    });

    it('confidence equals the exact fraction of non-null sub-probabilities', () => {
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction(50, 0.5),
          momentumCurve: [momentum(0, 0.5), momentum(1, 0.5)],
        }),
      );
      // hookStrength, replayPotential, buildIntensity, peakMomentum -> 4/8.
      expect(result.confidence).toBeCloseTo(4 / 8, 5);
    });
  });

  describe('reason', () => {
    it('names the strongest and weakest present dimension', () => {
      const result = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction(100, 0) }),
      );
      expect(result.reason).toContain('hook strength');
      expect(result.reason).toContain('replay potential');
    });

    it('names a single dimension without strongest/weakest wording when only one is present', () => {
      const result = computeViralityPrediction(baseInput({ momentumCurve: [momentum(0, 0.5)] }));
      expect(result.reason).toContain('peak momentum');
      expect(result.reason).not.toContain('strongest signal');
    });
  });
});
