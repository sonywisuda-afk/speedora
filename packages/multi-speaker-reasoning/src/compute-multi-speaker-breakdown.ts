import type {
  ComputeMultiSpeakerBreakdownInput,
  MultiSpeakerBreakdown,
  SpeakerAttribution,
  SpeakerTimelineEntry,
  VocalEmotion,
} from '@speedora/contracts';

// How much of the clip's opening counts as "the hook" for
// hookWindowTalkTimeRatio's purposes - the exact same value and reasoning
// as @speedora/hook-prediction's own HOOK_WINDOW_SECONDS (re-declared here
// rather than imported - not worth a cross-package dependency for one
// constant). Not derived from any real engagement data (ADR D4).
const HOOK_WINDOW_SECONDS = 5;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function overlapSeconds(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function isWithinAnyTurn(t: number, turns: SpeakerTimelineEntry[]): boolean {
  return turns.some((turn) => t >= turn.start && t < turn.end);
}

function averageAndPeak(values: number[]): { average: number | null; peak: number | null } {
  if (values.length === 0) return { average: null, peak: null };
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { average, peak: Math.max(...values) };
}

// Most frequent emotion among a speaker's classified samples - ties broken
// by whichever emotion is encountered first (VOCAL_EMOTIONS iteration
// order is stable but not itself meaningful; a documented, unvalidated
// tie-break, same "reasonable default" convention as every other cap/tier
// in this pipeline).
function findDominantEmotion(emotions: VocalEmotion[]): VocalEmotion | null {
  if (emotions.length === 0) return null;
  const counts = new Map<VocalEmotion, number>();
  for (const emotion of emotions) {
    counts.set(emotion, (counts.get(emotion) ?? 0) + 1);
  }
  let dominant: VocalEmotion | null = null;
  let dominantCount = 0;
  for (const [emotion, count] of counts) {
    if (count > dominantCount) {
      dominant = emotion;
      dominantCount = count;
    }
  }
  return dominant;
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter at all, same
// zero-LLM shape as Phases 4-5. A post-hoc ATTRIBUTION pass: intersects
// Phase 4's MomentumCurve and Phase 5's EmotionalArc against Speaker
// Intelligence's SpeakerTimelineEntry[] to answer "which speaker owns
// this moment," never re-deriving any of the three inputs itself.
//
// Returns null for the majority single-speaker case (no speakerTimeline
// data, or fewer than 2 distinct speakers) - this is the module's OWN
// correct, honest "not applicable" result, not a failure. See the
// contract's own doc comment for why this null-meaning differs from
// Phase 4/5's "predates migration" null.
export function computeMultiSpeakerBreakdown(
  input: ComputeMultiSpeakerBreakdownInput,
): MultiSpeakerBreakdown | null {
  const { speakerTimeline, momentumCurve, emotionalArc } = input;
  if (!speakerTimeline || speakerTimeline.length === 0) {
    return null;
  }

  const distinctSpeakers = [...new Set(speakerTimeline.map((entry) => entry.speaker))];
  if (distinctSpeakers.length < 2) {
    return null;
  }

  const totalTalkTimeSeconds = speakerTimeline.reduce(
    (sum, entry) => sum + (entry.end - entry.start),
    0,
  );
  const totalHookWindowSeconds = speakerTimeline.reduce(
    (sum, entry) => sum + overlapSeconds(entry.start, entry.end, 0, HOOK_WINDOW_SECONDS),
    0,
  );

  const attributions = distinctSpeakers.map((speaker): SpeakerAttribution => {
    const turns = speakerTimeline.filter((entry) => entry.speaker === speaker);

    const talkTimeSeconds = turns.reduce((sum, turn) => sum + (turn.end - turn.start), 0);
    const talkTimeRatio =
      totalTalkTimeSeconds > 0 ? clamp01(talkTimeSeconds / totalTalkTimeSeconds) : 0;

    const hookWindowSeconds = turns.reduce(
      (sum, turn) => sum + overlapSeconds(turn.start, turn.end, 0, HOOK_WINDOW_SECONDS),
      0,
    );
    const hookWindowTalkTimeRatio =
      totalHookWindowSeconds > 0 ? clamp01(hookWindowSeconds / totalHookWindowSeconds) : 0;

    const momentumScores = momentumCurve
      .filter((sample) => isWithinAnyTurn(sample.t, turns))
      .map((sample) => sample.momentumScore);
    const { average: averageMomentumScore, peak: peakMomentumScore } =
      averageAndPeak(momentumScores);

    const emotionSamples = emotionalArc.filter((sample) => isWithinAnyTurn(sample.t, turns));
    const { average: averageEmotionalIntensity } = averageAndPeak(
      emotionSamples.map((sample) => sample.intensity),
    );
    const emotions = emotionSamples
      .map((sample) => sample.emotion)
      .filter((emotion): emotion is VocalEmotion => emotion !== null);

    return {
      speaker,
      talkTimeRatio,
      hookWindowTalkTimeRatio,
      averageMomentumScore,
      peakMomentumScore,
      dominantEmotion: findDominantEmotion(emotions),
      averageEmotionalIntensity,
    };
  });

  return attributions.sort((a, b) => b.talkTimeRatio - a.talkTimeRatio);
}
