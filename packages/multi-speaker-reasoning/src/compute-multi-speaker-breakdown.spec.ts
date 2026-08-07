import type {
  ComputeMultiSpeakerBreakdownInput,
  EmotionalArcSample,
  MomentumSample,
  SpeakerTimelineEntry,
} from '@speedora/contracts';
import { computeMultiSpeakerBreakdown } from './compute-multi-speaker-breakdown';

function baseInput(
  overrides: Partial<ComputeMultiSpeakerBreakdownInput> = {},
): ComputeMultiSpeakerBreakdownInput {
  return {
    speakerTimeline: null,
    momentumCurve: [],
    emotionalArc: [],
    ...overrides,
  };
}

function turn(speaker: string, start: number, end: number): SpeakerTimelineEntry {
  return { speaker, start, end, faceTrackId: null, isActiveOnScreen: null };
}

function momentum(t: number, momentumScore: number): MomentumSample {
  return { t, momentumScore };
}

function emotion(
  t: number,
  emotionLabel: EmotionalArcSample['emotion'],
  intensity: number,
): EmotionalArcSample {
  return { t, emotion: emotionLabel, intensity };
}

describe('computeMultiSpeakerBreakdown', () => {
  it('returns null when speakerTimeline is null (no diarization data)', () => {
    expect(computeMultiSpeakerBreakdown(baseInput())).toBeNull();
  });

  it('returns null when speakerTimeline is an empty array', () => {
    expect(computeMultiSpeakerBreakdown(baseInput({ speakerTimeline: [] }))).toBeNull();
  });

  it('returns null for a single-speaker timeline, even with multiple turns - the majority case must not be affected', () => {
    const speakerTimeline = [
      turn('Speaker A', 0, 3),
      turn('Speaker A', 3, 6),
      turn('Speaker A', 6, 9),
    ];
    expect(computeMultiSpeakerBreakdown(baseInput({ speakerTimeline }))).toBeNull();
  });

  it('returns a real, sorted-by-talkTimeRatio-descending array for 2+ distinct speakers', () => {
    const speakerTimeline = [turn('Speaker A', 0, 7), turn('Speaker B', 7, 10)];
    const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline }));

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].speaker).toBe('Speaker A');
    expect(result![1].speaker).toBe('Speaker B');
  });

  it('does not throw with empty momentumCurve/emotionalArc arrays', () => {
    const speakerTimeline = [turn('Speaker A', 0, 5), turn('Speaker B', 5, 10)];
    expect(() => computeMultiSpeakerBreakdown(baseInput({ speakerTimeline }))).not.toThrow();
  });

  describe('talkTimeRatio', () => {
    it('sums to 1 (within floating-point tolerance) across all speakers', () => {
      const speakerTimeline = [
        turn('Speaker A', 0, 3),
        turn('Speaker B', 3, 6),
        turn('Speaker A', 6, 10),
      ];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline }))!;
      const total = result.reduce((sum, attribution) => sum + attribution.talkTimeRatio, 0);
      expect(total).toBeCloseTo(1, 5);
    });

    it('correctly attributes non-contiguous turns to the same speaker', () => {
      const speakerTimeline = [
        turn('Speaker A', 0, 3),
        turn('Speaker B', 3, 6),
        turn('Speaker A', 6, 10),
      ];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline }))!;
      const speakerA = result.find((attribution) => attribution.speaker === 'Speaker A')!;
      const speakerB = result.find((attribution) => attribution.speaker === 'Speaker B')!;
      // Speaker A: (3-0) + (10-6) = 7s of 10s total.
      expect(speakerA.talkTimeRatio).toBeCloseTo(0.7, 5);
      // Speaker B: (6-3) = 3s of 10s total.
      expect(speakerB.talkTimeRatio).toBeCloseTo(0.3, 5);
    });
  });

  describe('hookWindowTalkTimeRatio', () => {
    it('only considers speaking time within the opening 5-second window', () => {
      // A speaks the whole hook window; B speaks entirely after it.
      const speakerTimeline = [turn('Speaker A', 0, 5), turn('Speaker B', 5, 20)];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline }))!;
      const speakerA = result.find((attribution) => attribution.speaker === 'Speaker A')!;
      const speakerB = result.find((attribution) => attribution.speaker === 'Speaker B')!;
      expect(speakerA.hookWindowTalkTimeRatio).toBe(1);
      expect(speakerB.hookWindowTalkTimeRatio).toBe(0);
    });

    it('splits the ratio proportionally when multiple speakers share the window', () => {
      // A: [0,3) inside window (3s); B: [3,6) -> only [3,5) inside window (2s).
      const speakerTimeline = [turn('Speaker A', 0, 3), turn('Speaker B', 3, 6)];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline }))!;
      const speakerA = result.find((attribution) => attribution.speaker === 'Speaker A')!;
      const speakerB = result.find((attribution) => attribution.speaker === 'Speaker B')!;
      expect(speakerA.hookWindowTalkTimeRatio).toBeCloseTo(0.6, 5);
      expect(speakerB.hookWindowTalkTimeRatio).toBeCloseTo(0.4, 5);
    });
  });

  describe('momentum attribution', () => {
    it('scopes momentumCurve samples to each speaker own turns, never cross-attributing', () => {
      const speakerTimeline = [turn('Speaker A', 0, 3), turn('Speaker B', 3, 6)];
      const momentumCurve = [momentum(1, 0.2), momentum(2, 0.4), momentum(4, 0.9)];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline, momentumCurve }))!;
      const speakerA = result.find((attribution) => attribution.speaker === 'Speaker A')!;
      const speakerB = result.find((attribution) => attribution.speaker === 'Speaker B')!;

      expect(speakerA.averageMomentumScore).toBeCloseTo(0.3, 5);
      expect(speakerA.peakMomentumScore).toBeCloseTo(0.4, 5);
      expect(speakerB.averageMomentumScore).toBeCloseTo(0.9, 5);
      expect(speakerB.peakMomentumScore).toBeCloseTo(0.9, 5);
    });

    it('returns null averageMomentumScore/peakMomentumScore for a speaker with zero overlapping samples', () => {
      const speakerTimeline = [turn('Speaker A', 0, 3), turn('Speaker B', 3, 6)];
      const momentumCurve = [momentum(1, 0.2)];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline, momentumCurve }))!;
      const speakerB = result.find((attribution) => attribution.speaker === 'Speaker B')!;

      expect(speakerB.averageMomentumScore).toBeNull();
      expect(speakerB.peakMomentumScore).toBeNull();
    });
  });

  describe('emotion attribution', () => {
    it('scopes emotionalArc samples to each speaker own turns and finds the dominant emotion', () => {
      const speakerTimeline = [turn('Speaker A', 0, 3), turn('Speaker A', 6, 10)];
      const emotionalArc = [
        emotion(1, 'hap', 0.65),
        emotion(2, 'hap', 0.7),
        emotion(7, 'ang', 0.85),
      ];
      const speakerTimelineWithB = [...speakerTimeline, turn('Speaker B', 3, 6)];
      const result = computeMultiSpeakerBreakdown(
        baseInput({ speakerTimeline: speakerTimelineWithB, emotionalArc }),
      )!;
      const speakerA = result.find((attribution) => attribution.speaker === 'Speaker A')!;

      expect(speakerA.dominantEmotion).toBe('hap');
      expect(speakerA.averageEmotionalIntensity).toBeCloseTo((0.65 + 0.7 + 0.85) / 3, 5);
    });

    it('a null-emotion sample counts toward averageEmotionalIntensity (as 0) but not toward dominantEmotion', () => {
      const speakerTimeline = [turn('Speaker A', 0, 3), turn('Speaker B', 3, 6)];
      const emotionalArc = [emotion(1, 'hap', 0.65), emotion(2, null, 0)];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline, emotionalArc }))!;
      const speakerA = result.find((attribution) => attribution.speaker === 'Speaker A')!;

      expect(speakerA.dominantEmotion).toBe('hap');
      expect(speakerA.averageEmotionalIntensity).toBeCloseTo(0.325, 5);
    });

    it('returns null dominantEmotion/averageEmotionalIntensity for a speaker with zero overlapping samples', () => {
      const speakerTimeline = [turn('Speaker A', 0, 3), turn('Speaker B', 3, 6)];
      const emotionalArc = [emotion(1, 'hap', 0.65)];
      const result = computeMultiSpeakerBreakdown(baseInput({ speakerTimeline, emotionalArc }))!;
      const speakerB = result.find((attribution) => attribution.speaker === 'Speaker B')!;

      expect(speakerB.dominantEmotion).toBeNull();
      expect(speakerB.averageEmotionalIntensity).toBeNull();
    });
  });
});
