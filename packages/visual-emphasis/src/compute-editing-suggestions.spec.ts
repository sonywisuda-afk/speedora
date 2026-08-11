import type { ComputeEditingSuggestionsInput, RetentionCurveInsights } from '@speedora/contracts';
import { computeEditingSuggestions } from './compute-editing-suggestions';

function insights(overrides: Partial<RetentionCurveInsights> = {}): RetentionCurveInsights {
  return {
    clipId: 'clip-1',
    dropPoints: [],
    replayZones: [],
    emotionalPeaks: [],
    curiosityPeaks: [],
    ...overrides,
  };
}

describe('computeEditingSuggestions', () => {
  it('returns an empty timeline when every source signal is empty/null', () => {
    const input: ComputeEditingSuggestionsInput = {
      highlights: [],
      ocrTracks: null,
      primarySubjectSamples: [],
      retentionCurveInsights: insights(),
      words: [],
      clipDurationSeconds: 10,
      speakerTurns: [],
    };
    expect(computeEditingSuggestions(input)).toEqual([]);
  });

  it('merges suggestions from every technique into one chronologically-sorted timeline', () => {
    const input: ComputeEditingSuggestionsInput = {
      highlights: [{ start: 8, end: 9, score: 0.6 }],
      ocrTracks: [
        {
          trackId: 1,
          text: '$9.99',
          boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.05 },
          confidence: 0.9,
          startTime: 0,
          endTime: 1,
          durationSeconds: 1,
          appearsFrames: 5,
          persistenceScore: 0.5,
          motionScore: null,
          nearFace: null,
          language: null,
          regexFlags: { isPriceLike: true, isNameLike: false },
          category: 'price',
          categoryConfidence: 0.9,
          classificationMethod: 'HybridRuleEngine',
        },
      ],
      primarySubjectSamples: [
        {
          t: 2,
          trackId: 1,
          box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 },
          facingYaw: null,
          source: 'face',
        },
        {
          t: 4,
          trackId: 2,
          box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 },
          facingYaw: null,
          source: 'face',
        },
      ],
      retentionCurveInsights: insights({
        emotionalPeaks: [{ t: 6, score: 0.8 }],
        curiosityPeaks: [{ t: 13, score: 0.7 }],
      }),
      words: [
        { word: 'before', start: 10, end: 11 },
        { word: 'after', start: 14, end: 15 },
      ],
      clipDurationSeconds: 15,
      speakerTurns: [],
    };

    const result = computeEditingSuggestions(input);

    // 5 techniques should each contribute exactly one suggestion here.
    expect(result).toHaveLength(5);
    expect(result.map((s) => s.technique)).toEqual([
      'ocr_highlight',
      'focus_shift',
      'reaction_hold',
      'digital_push',
      'pause_hold',
    ]);
    // Chronologically sorted by start time.
    const starts = result.map((s) => s.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  // Attention Curve Optimization - a Phase 10 follow-up, NOT one of spec
  // Part 9's 9 named techniques (see from-drop-points.ts's own comment) -
  // a separate test from the "5 techniques" one above since it's a
  // conceptually distinct addition.
  it('includes an attention_cut suggestion when a sufficiently severe drop point is present', () => {
    const input: ComputeEditingSuggestionsInput = {
      highlights: [],
      ocrTracks: null,
      primarySubjectSamples: [],
      retentionCurveInsights: insights({ dropPoints: [{ t: 7, score: 0.8 }] }),
      words: [],
      clipDurationSeconds: 15,
      speakerTurns: [],
    };

    const result = computeEditingSuggestions(input);

    expect(result).toEqual([expect.objectContaining({ technique: 'attention_cut' })]);
  });

  // Speaker Intelligence Phase E - a separate test from the "5 techniques"
  // one above, same reasoning as the attention_cut test: conceptually
  // distinct addition, not one of spec Part 9's 9 named techniques (see
  // from-speaker-transitions.ts's own comment).
  it('includes a speaker_focus_shift suggestion for a well-held speaker transition', () => {
    const input: ComputeEditingSuggestionsInput = {
      highlights: [],
      ocrTracks: null,
      primarySubjectSamples: [],
      retentionCurveInsights: insights(),
      words: [],
      clipDurationSeconds: 10,
      speakerTurns: [
        { speaker: 'A', start: 0, end: 3 },
        { speaker: 'B', start: 3, end: 6 },
      ],
    };

    const result = computeEditingSuggestions(input);

    expect(result).toEqual([expect.objectContaining({ technique: 'speaker_focus_shift' })]);
  });
});
