import type {
  ComputeViralityPredictionInput,
  EmotionalArcSample,
  HookPredictionOutput,
  MomentumSample,
  NarrativeGraph,
  VocalEmotion,
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
  overrides: Partial<{
    expectedScrollStopRate: number;
    expectedRetentionLift: number;
    expectedReplayPotential: number;
    surpriseScore: number;
    controversyScore: number;
    questionDensity: number;
    numericFactCount: number;
    namedEntities: string[];
    dominantEmotion: string;
  }> = {},
): HookPredictionOutput {
  return {
    clipId: 'clip-1',
    hookProbability: 50,
    reason: 'test',
    confidence: 0.9,
    linguisticFeatures: {
      sentiment: 'neutral',
      dominantEmotion: overrides.dominantEmotion ?? 'neutral',
      surpriseScore: overrides.surpriseScore ?? 0.5,
      controversyScore: overrides.controversyScore ?? 0.5,
      keywordRarityScore: 0.5,
      topicShiftScore: 0.5,
      questionDensity: overrides.questionDensity ?? 0.5,
      numericFactCount: overrides.numericFactCount ?? 0,
      namedEntities: overrides.namedEntities ?? [],
    },
    predictionFeatures: {
      expectedScrollStopRate: overrides.expectedScrollStopRate ?? 0.5,
      expectedRetentionLift: overrides.expectedRetentionLift ?? 0,
      expectedReplayPotential: overrides.expectedReplayPotential ?? 0.5,
    },
  };
}

function momentum(t: number, momentumScore: number): MomentumSample {
  return { t, momentumScore };
}

function emotion(
  t: number,
  intensity: number,
  label: VocalEmotion | null = 'hap',
): EmotionalArcSample {
  return { t, emotion: label, intensity };
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
  it('returns every sub-probability null, overallViralScore null, confidence 0 when all inputs are null/empty', () => {
    const result = computeViralityPrediction(baseInput());

    expect(result.clipId).toBe('clip-1');
    expect(result.overallViralScore).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.subProbabilities).toEqual({
      scrollStopProbability: null,
      watchProbability: null,
      completionProbability: null,
      shareProbability: null,
      commentProbability: null,
      saveProbability: null,
      followProbability: null,
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

  // Regression test: an earlier version (Phase 7) used `narrativeGraph !== null`
  // (a strict check), which threw when the render-graph's own `get()` handed
  // back `undefined` rather than `null` for a not-yet-resolved/mocked dep
  // (caught by render-clip.worker.spec.ts's real integration fixtures). Same
  // `narrativeGraph != null` (loose, catches both) fix
  // @speedora/contextual-momentum's segmentAt() already uses - preserved
  // across Phase 9's realignment since every narrativeGraph-reading
  // probability below (watch/completion/comment/save) shares this helper.
  it('does not throw when narrativeGraph is undefined rather than null', () => {
    const input = { ...baseInput(), narrativeGraph: undefined } as unknown as ReturnType<
      typeof baseInput
    >;
    expect(() => computeViralityPrediction(input)).not.toThrow();
    const result = computeViralityPrediction(input);
    expect(result.subProbabilities.completionProbability).toBeNull();
    expect(result.subProbabilities.commentProbability).toBeNull();
    expect(result.subProbabilities.saveProbability).toBeNull();
  });

  describe('scrollStopProbability', () => {
    it('passes expectedScrollStopRate through directly', () => {
      const result = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction({ expectedScrollStopRate: 0.85 }) }),
      );
      expect(result.subProbabilities.scrollStopProbability).toBeCloseTo(0.85, 5);
    });

    it('is null when hookPrediction is null', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.scrollStopProbability).toBeNull();
    });
  });

  describe('watchProbability', () => {
    it('is null when momentumCurve, hookPrediction, and narrativeGraph are all unavailable', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.watchProbability).toBeNull();
    });

    it('averages momentumCurve samples when that is the only source', () => {
      const momentumCurve = [momentum(0, 0.2), momentum(1, 0.8)];
      const result = computeViralityPrediction(baseInput({ momentumCurve }));
      expect(result.subProbabilities.watchProbability).toBeCloseTo(0.5, 5);
    });

    it('normalizes expectedRetentionLift from -1..1 into 0..1 when that is the only source', () => {
      const positive = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction({ expectedRetentionLift: 1 }) }),
      );
      expect(positive.subProbabilities.watchProbability).toBeCloseTo(1, 5);

      const negative = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction({ expectedRetentionLift: -1 }) }),
      );
      expect(negative.subProbabilities.watchProbability).toBeCloseTo(0, 5);
    });

    it('uses narrativeGraph distinct segment types / 10 when that is the only source', () => {
      const narrativeGraph = narrativeGraphWith(['hook', 'setup', 'peak']);
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.watchProbability).toBeCloseTo(0.3, 5);
    });

    it('averages across all three sources when all are available', () => {
      const momentumCurve = [momentum(0, 0.5), momentum(1, 0.5)];
      const narrativeGraph = narrativeGraphWith(['hook', 'setup', 'peak']);
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction({ expectedRetentionLift: 0 }),
          momentumCurve,
          narrativeGraph,
        }),
      );
      // parts: momentum avg=0.5, retentionLift normalized=0.5, narrative=0.3 -> avg = 0.4333...
      expect(result.subProbabilities.watchProbability).toBeCloseTo((0.5 + 0.5 + 0.3) / 3, 5);
    });
  });

  describe('completionProbability', () => {
    it('is null when narrativeGraph is unusable and momentumCurve has fewer than 3 samples', () => {
      const result = computeViralityPrediction(baseInput({ momentumCurve: [momentum(0, 0.5)] }));
      expect(result.subProbabilities.completionProbability).toBeNull();
    });

    it('is 1 when narrativeGraph has a resolves relation (payoff) and no momentum data', () => {
      const narrativeGraph = narrativeGraphWith(
        ['problem', 'resolution'],
        [{ fromSegmentId: 1, toSegmentId: 0, type: 'resolves' }],
      );
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.completionProbability).toBe(1);
    });

    it('is 0 when narrativeGraph has no payoff and no momentum data', () => {
      const narrativeGraph = narrativeGraphWith(['hook', 'setup']);
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.completionProbability).toBe(0);
    });

    it('uses the average momentumScore over the final third of the curve when >= 3 samples exist', () => {
      const momentumCurve = [momentum(0, 0.1), momentum(1, 0.1), momentum(2, 0.7)];
      const result = computeViralityPrediction(baseInput({ momentumCurve }));
      expect(result.subProbabilities.completionProbability).toBeCloseTo(0.7, 5);
    });

    it('averages the narrativeGraph and late-momentum parts when both are available', () => {
      const narrativeGraph = narrativeGraphWith(['hook', 'setup']); // no payoff -> 0
      const momentumCurve = [momentum(0, 0.1), momentum(1, 0.1), momentum(2, 0.6)]; // late = 0.6
      const result = computeViralityPrediction(baseInput({ narrativeGraph, momentumCurve }));
      expect(result.subProbabilities.completionProbability).toBeCloseTo(0.3, 5);
    });
  });

  describe('shareProbability', () => {
    it('is null when hookPrediction is null and emotionalArc is empty', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.shareProbability).toBeNull();
    });

    it('averages surpriseScore and controversyScore when hookPrediction is the only source', () => {
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction({ surpriseScore: 0.8, controversyScore: 0.4 }),
        }),
      );
      expect(result.subProbabilities.shareProbability).toBeCloseTo(0.6, 5);
    });

    it('uses the max emotionalArc intensity when that is the only source', () => {
      const emotionalArc = [emotion(0, 0.2), emotion(1, 0.9), emotion(2, 0.5)];
      const result = computeViralityPrediction(baseInput({ emotionalArc }));
      expect(result.subProbabilities.shareProbability).toBeCloseTo(0.9, 5);
    });
  });

  describe('commentProbability', () => {
    it('is null when hookPrediction is null and narrativeGraph is unusable', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.commentProbability).toBeNull();
    });

    it('averages controversyScore and questionDensity when hookPrediction is the only source', () => {
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction({ controversyScore: 0.6, questionDensity: 0.8 }),
        }),
      );
      expect(result.subProbabilities.commentProbability).toBeCloseTo(0.7, 5);
    });

    it('is 1 when narrativeGraph has unresolved tension (conflict/escalation without a resolves relation)', () => {
      const narrativeGraph = narrativeGraphWith(['setup', 'conflict']);
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.commentProbability).toBe(1);
    });

    it('is 0 when the same tension segment is resolved', () => {
      const narrativeGraph = narrativeGraphWith(
        ['setup', 'conflict', 'resolution'],
        [{ fromSegmentId: 2, toSegmentId: 1, type: 'resolves' }],
      );
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.commentProbability).toBe(0);
    });
  });

  describe('saveProbability', () => {
    it('is null when hookPrediction is null and narrativeGraph is unusable', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.saveProbability).toBeNull();
    });

    it('averages numericFactCount/5 and namedEntities.length/5 when hookPrediction is the only source', () => {
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction({ numericFactCount: 3, namedEntities: ['A', 'B'] }),
        }),
      );
      // factScore = 3/5 = 0.6, entityScore = 2/5 = 0.4 -> avg 0.5.
      expect(result.subProbabilities.saveProbability).toBeCloseTo(0.5, 5);
    });

    it('clamps numericFactCount/namedEntities above the ceiling to 1', () => {
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction({
            numericFactCount: 20,
            namedEntities: ['A', 'B', 'C', 'D', 'E', 'F'],
          }),
        }),
      );
      expect(result.subProbabilities.saveProbability).toBe(1);
    });

    it('is 1 when narrativeGraph has a takeaway segment', () => {
      const narrativeGraph = narrativeGraphWith(['problem', 'takeaway']);
      const result = computeViralityPrediction(baseInput({ narrativeGraph }));
      expect(result.subProbabilities.saveProbability).toBe(1);
    });
  });

  describe('followProbability', () => {
    it('is null when hookPrediction is null and emotionalArc has no classified samples', () => {
      const result = computeViralityPrediction(baseInput());
      expect(result.subProbabilities.followProbability).toBeNull();
    });

    it('is 1 when dominantEmotion is a positive one', () => {
      const result = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction({ dominantEmotion: 'hap' }) }),
      );
      expect(result.subProbabilities.followProbability).toBe(1);
    });

    it('is 0 when dominantEmotion is not a positive one', () => {
      const result = computeViralityPrediction(
        baseInput({ hookPrediction: hookPrediction({ dominantEmotion: 'sad' }) }),
      );
      expect(result.subProbabilities.followProbability).toBe(0);
    });

    it('uses the ratio of hap samples among classified emotionalArc samples', () => {
      const emotionalArc = [emotion(0, 0.5, 'hap'), emotion(1, 0.5, 'sad'), emotion(2, 0.5, 'hap')];
      const result = computeViralityPrediction(baseInput({ emotionalArc }));
      expect(result.subProbabilities.followProbability).toBeCloseTo(2 / 3, 5);
    });

    it('ignores samples with a null emotion when computing the ratio', () => {
      const emotionalArc = [emotion(0, 0.5, null), emotion(1, 0.5, 'hap')];
      const result = computeViralityPrediction(baseInput({ emotionalArc }));
      expect(result.subProbabilities.followProbability).toBe(1);
    });
  });

  describe('composite overallViralScore / confidence', () => {
    it('averages only the non-null sub-probabilities (partial coverage from hookPrediction alone)', () => {
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction({
            expectedScrollStopRate: 0.5,
            expectedRetentionLift: 0,
            surpriseScore: 0.5,
            controversyScore: 0.5,
            questionDensity: 0.5,
            numericFactCount: 3,
            namedEntities: ['A', 'B'],
            dominantEmotion: 'hap',
          }),
        }),
      );
      // completionProbability stays null (no narrativeGraph, no momentumCurve)
      // -> 6 of 7 non-null: scrollStop=0.5, watch=0.5, share=0.5, comment=0.5,
      // save=0.5, follow=1.
      expect(result.subProbabilities.completionProbability).toBeNull();
      const expectedAverage = (0.5 + 0.5 + 0.5 + 0.5 + 0.5 + 1) / 6;
      expect(result.overallViralScore).toBeCloseTo(expectedAverage, 5);
      expect(result.confidence).toBeCloseTo(6 / 7, 5);
    });

    it('confidence equals the exact fraction of non-null sub-probabilities', () => {
      const momentumCurve = [momentum(0, 0.5), momentum(1, 0.5)];
      const narrativeGraph = narrativeGraphWith(['hook', 'setup', 'peak']);
      const result = computeViralityPrediction(baseInput({ momentumCurve, narrativeGraph }));
      // Non-null: watch (momentum+narrative), completion (narrative part,
      // even though hasPayoff=false -> 0 is still non-null), comment
      // (narrative part, unresolvedTension=false -> 0), save (narrative
      // part, hasTakeaway=false -> 0). Null: scrollStop, share, follow
      // (all need hookPrediction/emotionalArc, both absent).
      expect(result.subProbabilities.scrollStopProbability).toBeNull();
      expect(result.subProbabilities.shareProbability).toBeNull();
      expect(result.subProbabilities.followProbability).toBeNull();
      expect(result.confidence).toBeCloseTo(4 / 7, 5);
    });
  });

  describe('reason', () => {
    it('names the strongest and weakest present dimension', () => {
      const result = computeViralityPrediction(
        baseInput({
          hookPrediction: hookPrediction({
            expectedScrollStopRate: 1, // scrollStopProbability = 1, the strongest
            dominantEmotion: 'sad', // followProbability = 0, the weakest
            numericFactCount: 5,
            namedEntities: ['a'], // keeps saveProbability (0.6) above 0, so
            // followProbability is the unambiguous single weakest dimension
          }),
        }),
      );
      expect(result.reason).toContain('scroll-stop likelihood');
      expect(result.reason).toContain('follow likelihood');
    });

    it('names a single dimension without strongest/weakest wording when only one is present', () => {
      const result = computeViralityPrediction(baseInput({ momentumCurve: [momentum(0, 0.5)] }));
      expect(result.reason).toContain('sustained watch likelihood');
      expect(result.reason).not.toContain('strongest signal');
    });
  });
});
