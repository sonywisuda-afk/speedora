import { computeHighlightScore } from './compute-highlight-score';

describe('computeHighlightScore', () => {
  it('returns a null highlightScore, zero confidence, and a clear reason when no signal is present at all', () => {
    const result = computeHighlightScore({ clipId: 'clip-1' });
    expect(result.highlightScore).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.contributions).toEqual([]);
    expect(result.explainability.topFactors).toEqual([]);
    expect(result.reason).toBe('No signals were available to score this clip.');
  });

  it('scores a clip with only loud audio, using the default weight table', () => {
    const result = computeHighlightScore({
      clipId: 'clip-1',
      audio: {
        averageRmsDb: -10,
        peakDb: -2,
        averageSpeakingRateWordsPerSecond: 2,
        speakingRateStdDev: null,
      },
    });
    expect(result.highlightScore).toBe(100);
    expect(result.confidence).toBeCloseTo(0.35);
    expect(result.contributions).toEqual([
      {
        signal: 'audio',
        feature: 'averageRmsDb',
        rawValue: -10,
        normalizedValue: 1,
        weight: 0.35,
        weightedContribution: 0.35,
      },
    ]);
    expect(result.reason).toContain('igh vocal energy');
  });

  it('gives a zero-cut scene clip the same non-zero baseline score as v1', () => {
    const result = computeHighlightScore({
      clipId: 'clip-1',
      scene: {
        cutCount: 0,
        cutsPerMinute: 0,
        averageSegmentSeconds: 30,
        hardCutCount: 0,
        fadeCount: 0,
        dissolveCount: 0,
      },
    });
    expect(result.highlightScore).toBe(20);
  });

  it('averages weighted contributions across multiple available signals', () => {
    const result = computeHighlightScore({
      clipId: 'clip-1',
      audio: {
        averageRmsDb: -10,
        peakDb: -2,
        averageSpeakingRateWordsPerSecond: 2,
        speakingRateStdDev: null,
      },
      scene: {
        cutCount: 0,
        cutsPerMinute: 0,
        averageSegmentSeconds: 30,
        hardCutCount: 0,
        fadeCount: 0,
        dissolveCount: 0,
      },
    });
    // audio contributes 0.35 weight at normalizedValue 1 (=0.35), scene
    // contributes 0.25 weight at normalizedValue 0.2 (=0.05) -> (0.40/0.60)*100.
    // Confidence coverage: (0.35+0.25) present / 1.0 total configured weight.
    expect(result.highlightScore).toBe(67);
    expect(result.confidence).toBeCloseTo(0.6);
  });

  it('lowers both the score and the confidence when facial peakConfidence is low, unlike v1s damping approach', () => {
    const highConfidence = computeHighlightScore({
      clipId: 'clip-1',
      facial: {
        dominantEmotion: 'happy',
        emotionTransitions: 0,
        peakConfidence: 1,
        stability: null,
      },
    });
    const lowConfidence = computeHighlightScore({
      clipId: 'clip-1',
      facial: {
        dominantEmotion: 'happy',
        emotionTransitions: 0,
        peakConfidence: 0.1,
        stability: null,
      },
    });
    expect(lowConfidence.highlightScore!).toBeLessThan(highConfidence.highlightScore!);
    expect(lowConfidence.confidence).toBeLessThan(highConfidence.confidence);
  });

  it('extracts and reports gesture features in contributions even though gesture has zero weight by default', () => {
    const result = computeHighlightScore({
      clipId: 'clip-1',
      gesture: {
        dominantGesture: 'thumb_up',
        gestureTransitions: 0,
        peakConfidence: 0.9,
        stability: null,
      },
    });
    // Zero total weight -> null score, even though real gesture data exists.
    expect(result.highlightScore).toBeNull();
    expect(result.confidence).toBe(0);
    // But nothing is silently dropped - both gesture features show up with
    // weight 0, proving the "richer information, nothing lost" requirement.
    expect(result.contributions).toEqual([
      {
        signal: 'gesture',
        feature: 'dominantGestureWeight',
        rawValue: null,
        normalizedValue: 0.9,
        weight: 0,
        weightedContribution: 0,
      },
      {
        signal: 'gesture',
        feature: 'peakConfidence',
        rawValue: 0.9,
        normalizedValue: 0.9,
        weight: 0,
        weightedContribution: 0,
      },
    ]);
  });

  it("does not let a zero-weight signal's peakConfidence influence overall confidence", () => {
    const withoutGesture = computeHighlightScore({
      clipId: 'clip-1',
      scene: {
        cutCount: 0,
        cutsPerMinute: 0,
        averageSegmentSeconds: 30,
        hardCutCount: 0,
        fadeCount: 0,
        dissolveCount: 0,
      },
    });
    const withGesture = computeHighlightScore({
      clipId: 'clip-1',
      scene: {
        cutCount: 0,
        cutsPerMinute: 0,
        averageSegmentSeconds: 30,
        hardCutCount: 0,
        fadeCount: 0,
        dissolveCount: 0,
      },
      gesture: {
        dominantGesture: 'thumb_up',
        gestureTransitions: 0,
        peakConfidence: 0.1,
        stability: null,
      },
    });
    expect(withGesture.highlightScore).toBe(withoutGesture.highlightScore);
    expect(withGesture.confidence).toBe(withoutGesture.confidence);
  });

  it('accepts a custom weight table overriding the defaults', () => {
    const result = computeHighlightScore(
      {
        clipId: 'clip-1',
        gesture: {
          dominantGesture: 'thumb_up',
          gestureTransitions: 0,
          peakConfidence: 1,
          stability: null,
        },
      },
      { gesture: 1 },
    );
    expect(result.highlightScore).not.toBeNull();
    expect(result.highlightScore).toBeGreaterThan(0);
  });

  it('limits explainability to the top 3 highest-magnitude contributions', () => {
    const result = computeHighlightScore({
      clipId: 'clip-1',
      audio: {
        averageRmsDb: -10,
        peakDb: -2,
        averageSpeakingRateWordsPerSecond: 2,
        speakingRateStdDev: 1,
      },
      scene: {
        cutCount: 2,
        cutsPerMinute: 12,
        averageSegmentSeconds: 5,
        hardCutCount: 2,
        fadeCount: 0,
        dissolveCount: 0,
      },
      facial: {
        dominantEmotion: 'happy',
        emotionTransitions: 0,
        peakConfidence: 0.9,
        stability: 0.8,
      },
    });
    expect(result.explainability.topFactors.length).toBeLessThanOrEqual(3);
  });

  it('rejects a malformed input against the fusionInputSchema contract', () => {
    expect(() =>
      computeHighlightScore({ clipId: 'clip-1', audio: { averageRmsDb: 'loud' } } as never),
    ).toThrow();
  });

  describe('llm signal (Fase 32)', () => {
    const UNIFORM_LLM_SCORES = {
      hookStrength: 80,
      educationalValue: 80,
      practicalValue: 80,
      curiosity: 80,
      emotion: 80,
      storytelling: 80,
      novelty: 80,
      trustAuthority: 80,
      ctaStrength: 80,
    };

    it('extracts all 9 ClipScores dimensions as separate llm-signal contributions', () => {
      const result = computeHighlightScore({ clipId: 'clip-1', llm: UNIFORM_LLM_SCORES });

      expect(result.contributions).toHaveLength(9);
      expect(result.contributions.every((c) => c.signal === 'llm')).toBe(true);
      // Every dimension is equally 80/100 here, so the weighted average
      // equals 80 regardless of how the llm weight is split across them.
      expect(result.highlightScore).toBe(80);
    });

    it('weights the llm signal at its configured share (5% by default) toward overall confidence', () => {
      const result = computeHighlightScore({ clipId: 'clip-1', llm: UNIFORM_LLM_SCORES });
      expect(result.confidence).toBeCloseTo(0.05);
    });
  });

  describe('prediction and recommendation (Fase 32)', () => {
    it('predicts likely_high_performer and recommends publishing as-is for a strong, confident clip', () => {
      const result = computeHighlightScore({
        clipId: 'clip-1',
        audio: {
          averageRmsDb: -10,
          peakDb: -2,
          averageSpeakingRateWordsPerSecond: 2,
          speakingRateStdDev: null,
        },
        scene: {
          cutCount: 2,
          cutsPerMinute: 20,
          averageSegmentSeconds: 3,
          hardCutCount: 2,
          fadeCount: 0,
          dissolveCount: 0,
        },
      });
      expect(result.prediction.bucket).toBe('likely_high_performer');
      expect(result.recommendation.action).toBe('publish_as_is');
    });

    it('predicts uncertain and recommends manual review when nothing was available to score', () => {
      const result = computeHighlightScore({ clipId: 'clip-1' });
      expect(result.prediction.bucket).toBe('uncertain');
      expect(result.recommendation.action).toBe('review_manually');
    });
  });
});
