import type {
  ClipScores,
  ComputeClipRankInput,
  RetentionCurveInsights,
  RetentionPoint,
  ViralityPrediction,
} from '@speedora/contracts';
import { deriveNarrativeGraphScore, deriveSemanticEventsScore } from '@speedora/virality-engine';
import { deriveSubScores } from './derive-sub-scores';

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

function viralityPrediction(overallViralScore: number | null): ViralityPrediction {
  return {
    clipId: 'clip-1',
    overallViralScore,
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
  };
}

function retentionPoint(overrides: Partial<RetentionPoint> = {}): RetentionPoint {
  return { t: 5, score: 0.5, ...overrides };
}

function retentionInsights(
  overrides: Partial<RetentionCurveInsights> = {},
): RetentionCurveInsights {
  return {
    clipId: 'clip-1',
    dropPoints: [],
    replayZones: [],
    emotionalPeaks: [],
    curiosityPeaks: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<ComputeClipRankInput> = {}): ComputeClipRankInput {
  return {
    clipId: 'clip-1',
    highlightScore: 50,
    scores: NEUTRAL_SCORES,
    viralityPrediction: viralityPrediction(0.5),
    hookPrediction: null,
    narrativeGraph: null,
    retentionCurveInsights: retentionInsights(),
    semanticEvents: null,
    ...overrides,
  };
}

describe('deriveSubScores', () => {
  it('maps highlightScore directly to fusion, including a null passthrough', () => {
    expect(deriveSubScores(baseInput({ highlightScore: 73 })).fusion).toBe(73);
    expect(deriveSubScores(baseInput({ highlightScore: null })).fusion).toBeNull();
  });

  it('converts viralityPrediction.overallViralScore from 0-1 to 0-100, with a null passthrough', () => {
    expect(
      deriveSubScores(baseInput({ viralityPrediction: viralityPrediction(0.8) })).virality,
    ).toBe(80);
    expect(
      deriveSubScores(baseInput({ viralityPrediction: viralityPrediction(null) })).virality,
    ).toBeNull();
  });

  it('scores narrative as null when narrativeGraph is null, and delegates to the shared formula otherwise', () => {
    expect(deriveSubScores(baseInput({ narrativeGraph: null })).narrative).toBeNull();

    const graph = { segments: [], relations: [], unsegmented: true };
    expect(deriveSubScores(baseInput({ narrativeGraph: graph })).narrative).toBe(
      deriveNarrativeGraphScore(graph),
    );
  });

  it('maps hookPrediction.hookProbability directly, null when hookPrediction is null', () => {
    expect(deriveSubScores(baseInput({ hookPrediction: null })).hook).toBeNull();

    const hookPrediction = {
      clipId: 'clip-1',
      hookProbability: 66,
      reason: 'because',
      confidence: 0.5,
      linguisticFeatures: {
        sentiment: 'positive' as const,
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
    };
    expect(deriveSubScores(baseInput({ hookPrediction })).hook).toBe(66);
  });

  it('scores semanticImportance as null when semanticEvents is null, and delegates to the shared formula otherwise', () => {
    expect(deriveSubScores(baseInput({ semanticEvents: null })).semanticImportance).toBeNull();

    const events = [
      {
        type: 'success' as const,
        t: 1,
        confidence: 0.9,
        importance: 0.9,
        evidence: [],
        reason: 'x',
      },
    ];
    expect(deriveSubScores(baseInput({ semanticEvents: events })).semanticImportance).toBe(
      deriveSemanticEventsScore(events),
    );
  });

  it('never scores retention as null, and lands at the neutral baseline with no detected points either way', () => {
    const score = deriveSubScores(
      baseInput({ retentionCurveInsights: retentionInsights() }),
    ).retention;
    expect(score).toBe(60);
  });

  it('penalizes retention for drop points and rewards it for engagement points, staying within [0, 100]', () => {
    const withDrops = deriveSubScores(
      baseInput({
        retentionCurveInsights: retentionInsights({
          dropPoints: [retentionPoint({ score: 1 })],
        }),
      }),
    ).retention;
    const withEngagement = deriveSubScores(
      baseInput({
        retentionCurveInsights: retentionInsights({
          replayZones: [retentionPoint({ score: 1 })],
        }),
      }),
    ).retention;
    const neutral = deriveSubScores(baseInput()).retention;

    expect(withDrops).toBeLessThan(neutral);
    expect(withEngagement).toBeGreaterThan(neutral);
    expect(withDrops).toBeGreaterThanOrEqual(0);
    expect(withEngagement).toBeLessThanOrEqual(100);
  });

  it('maps the 6 ClipScores dimensions directly, unaltered', () => {
    const scores: ClipScores = {
      hookStrength: 10,
      educationalValue: 20,
      practicalValue: 30,
      curiosity: 40,
      emotion: 50,
      storytelling: 60,
      novelty: 70,
      trustAuthority: 80,
      ctaStrength: 90,
    };
    const subScores = deriveSubScores(baseInput({ scores }));

    expect(subScores.novelty).toBe(70);
    expect(subScores.emotion).toBe(50);
    expect(subScores.practicalValue).toBe(30);
    expect(subScores.educationalValue).toBe(20);
    expect(subScores.curiosity).toBe(40);
    expect(subScores.trustAuthority).toBe(80);
  });
});
