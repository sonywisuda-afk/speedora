import type { ClipScores, ComputeClipRankInput } from '@speedora/contracts';
import { rankClipCandidates } from './rank-clips';

const NEUTRAL_SCORES: ClipScores = {
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

function input(overrides: Partial<ComputeClipRankInput> = {}): ComputeClipRankInput {
  return {
    clipId: 'clip-1',
    highlightScore: 50,
    scores: NEUTRAL_SCORES,
    viralityPrediction: {
      clipId: 'clip-1',
      overallViralScore: 0.5,
      confidence: 0.5,
      reason: 'because',
      subProbabilities: {
        scrollStopProbability: null,
        watchProbability: null,
        completionProbability: null,
        shareProbability: null,
        commentProbability: null,
        saveProbability: null,
        followProbability: null,
      },
    },
    hookPrediction: null,
    narrativeGraph: null,
    retentionCurveInsights: {
      clipId: 'clip-1',
      dropPoints: [],
      replayZones: [],
      emotionalPeaks: [],
      curiosityPeaks: [],
    },
    semanticEvents: null,
    ...overrides,
  };
}

describe('rankClipCandidates', () => {
  it('ranks by descending compositeScore and assigns rank starting at 1', () => {
    const inputs = [
      input({ clipId: 'weak', highlightScore: 20, scores: { ...NEUTRAL_SCORES, novelty: 10 } }),
      input({ clipId: 'strong', highlightScore: 90, scores: { ...NEUTRAL_SCORES, novelty: 90 } }),
      input({ clipId: 'middle', highlightScore: 50 }),
    ];

    const ranked = rankClipCandidates(inputs);

    expect(ranked.map((clip) => clip.clipId)).toEqual(['strong', 'middle', 'weak']);
    expect(ranked.map((clip) => clip.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].compositeScore).toBeGreaterThan(ranked[1].compositeScore!);
    expect(ranked[1].compositeScore).toBeGreaterThan(ranked[2].compositeScore!);
  });

  it('reports full confidence (12/12) when every signal is present', () => {
    const [ranked] = rankClipCandidates([
      input({
        hookPrediction: {
          clipId: 'clip-1',
          hookProbability: 50,
          reason: 'because',
          confidence: 0.5,
          linguisticFeatures: {
            sentiment: 'positive',
            dominantEmotion: 'hap',
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
            expectedReplayPotential: 0.5,
          },
        },
        narrativeGraph: { segments: [], relations: [], unsegmented: true },
        semanticEvents: [],
      }),
    ]);

    expect(ranked.confidence).toBe(1);
  });

  it('reports reduced confidence when the 3 LLM-backed signals (hook/narrative/semantic) and highlightScore are unavailable', () => {
    const [ranked] = rankClipCandidates([
      input({
        highlightScore: null,
        hookPrediction: null,
        narrativeGraph: null,
        semanticEvents: null,
      }),
    ]);

    // 12 dimensions total; fusion/hook/narrative/semanticImportance null,
    // virality/retention + the 6 ClipScores fields (8 total) present.
    expect(ranked.confidence).toBe(8 / 12);
    expect(ranked.subScores.fusion).toBeNull();
    expect(ranked.subScores.hook).toBeNull();
    expect(ranked.subScores.narrative).toBeNull();
    expect(ranked.subScores.semanticImportance).toBeNull();
  });

  it('exposes the full subScores breakdown alongside the composite for each ranked clip', () => {
    const [ranked] = rankClipCandidates([input({ highlightScore: 42 })]);

    expect(ranked.subScores.fusion).toBe(42);
    expect(ranked.subScores.retention).toBe(60);
    expect(ranked.subScores.novelty).toBe(50);
  });

  it('handles an empty input array', () => {
    expect(rankClipCandidates([])).toEqual([]);
  });
});
