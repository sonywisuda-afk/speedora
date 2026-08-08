import type {
  ComputeRetentionCurveInsightsInput,
  EmotionalArcSample,
  MomentumSample,
  SemanticEvent,
  SemanticEventType,
} from '@speedora/contracts';
import { computeRetentionCurveInsights } from './compute-retention-curve-insights';

function baseInput(
  overrides: Partial<ComputeRetentionCurveInsightsInput> = {},
): ComputeRetentionCurveInsightsInput {
  return {
    clipId: 'clip-1',
    momentumCurve: [],
    emotionalArc: [],
    semanticEvents: null,
    ...overrides,
  };
}

function momentum(t: number, momentumScore: number): MomentumSample {
  return { t, momentumScore };
}

function emotion(t: number, intensity: number): EmotionalArcSample {
  return { t, emotion: 'hap', intensity };
}

function semanticEvent(type: SemanticEventType, t: number, importance: number): SemanticEvent {
  return { type, t, confidence: 0.9, importance, evidence: [], reason: 'test' };
}

// A clean single-trough curve: 4 flat samples at 0.8, one sharp drop to
// 0.0 at the end - well clear of the mean-1.5*stddev threshold.
const TROUGH_CURVE: MomentumSample[] = [
  momentum(0, 0.8),
  momentum(1, 0.8),
  momentum(2, 0.8),
  momentum(3, 0.8),
  momentum(4, 0.0),
];

// The mirror image: 4 flat samples at 0.1, one sharp rise to 0.9 at the
// end.
const PEAK_CURVE: MomentumSample[] = [
  momentum(0, 0.1),
  momentum(1, 0.1),
  momentum(2, 0.1),
  momentum(3, 0.1),
  momentum(4, 0.9),
];

describe('computeRetentionCurveInsights', () => {
  it('returns every array empty when all inputs are empty/null', () => {
    const result = computeRetentionCurveInsights(baseInput());
    expect(result.clipId).toBe('clip-1');
    expect(result.dropPoints).toEqual([]);
    expect(result.replayZones).toEqual([]);
    expect(result.emotionalPeaks).toEqual([]);
    expect(result.curiosityPeaks).toEqual([]);
  });

  describe('dropPoints', () => {
    it('finds a local minimum well below the mean', () => {
      const result = computeRetentionCurveInsights(baseInput({ momentumCurve: TROUGH_CURVE }));
      expect(result.dropPoints).toEqual([{ t: 4, score: 1 }]);
    });

    it('is empty for a flat curve (stddev 0)', () => {
      const flat = [momentum(0, 0.5), momentum(1, 0.5), momentum(2, 0.5)];
      const result = computeRetentionCurveInsights(baseInput({ momentumCurve: flat }));
      expect(result.dropPoints).toEqual([]);
    });
  });

  describe('replayZones', () => {
    it('finds a local maximum well above the mean, using momentumScore alone when emotionalArc is empty', () => {
      const result = computeRetentionCurveInsights(baseInput({ momentumCurve: PEAK_CURVE }));
      expect(result.replayZones).toEqual([{ t: 4, score: 0.9 }]);
    });

    it('boosts the score using the temporally-nearest emotionalArc sample when one exists', () => {
      const result = computeRetentionCurveInsights(
        baseInput({ momentumCurve: PEAK_CURVE, emotionalArc: [emotion(4, 0.5)] }),
      );
      // average(0.9, 0.5) = 0.7
      expect(result.replayZones).toEqual([{ t: 4, score: 0.7 }]);
    });

    it('uses the temporally-nearest sample, not necessarily an exact time match', () => {
      const result = computeRetentionCurveInsights(
        baseInput({
          momentumCurve: PEAK_CURVE,
          emotionalArc: [emotion(0, 0.9), emotion(3.5, 0.1)],
        }),
      );
      // nearest to t=4 is t=3.5 (distance 0.5) over t=0 (distance 4).
      expect(result.replayZones).toEqual([{ t: 4, score: 0.5 }]);
    });
  });

  describe('emotionalPeaks', () => {
    it('finds a local maximum in emotionalArc intensity', () => {
      const arc = [
        emotion(0, 0.1),
        emotion(1, 0.1),
        emotion(2, 0.1),
        emotion(3, 0.1),
        emotion(4, 0.9),
      ];
      const result = computeRetentionCurveInsights(baseInput({ emotionalArc: arc }));
      expect(result.emotionalPeaks).toEqual([{ t: 4, score: 0.9 }]);
    });

    it('is empty for a flat arc (stddev 0)', () => {
      const flat = [emotion(0, 0.3), emotion(1, 0.3), emotion(2, 0.3)];
      const result = computeRetentionCurveInsights(baseInput({ emotionalArc: flat }));
      expect(result.emotionalPeaks).toEqual([]);
    });
  });

  describe('curiosityPeaks', () => {
    it('is empty when semanticEvents is null', () => {
      const result = computeRetentionCurveInsights(baseInput());
      expect(result.curiosityPeaks).toEqual([]);
    });

    it('keeps only curiosity-flavored event types, using t/importance directly', () => {
      const semanticEvents = [
        semanticEvent('secret', 5, 0.7),
        semanticEvent('mistake', 2, 0.6),
        semanticEvent('breaking_news', 8, 0.4),
      ];
      const result = computeRetentionCurveInsights(baseInput({ semanticEvents }));
      expect(result.curiosityPeaks).toEqual([
        { t: 5, score: 0.7 },
        { t: 8, score: 0.4 },
      ]);
    });

    it('is empty when semanticEvents has no curiosity-flavored types', () => {
      const semanticEvents = [semanticEvent('mistake', 2, 0.6), semanticEvent('success', 3, 0.8)];
      const result = computeRetentionCurveInsights(baseInput({ semanticEvents }));
      expect(result.curiosityPeaks).toEqual([]);
    });
  });
});
