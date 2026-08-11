import type { ConversationDynamics, DiarizationFeatures } from '@speedora/contracts';

// Speaker Intelligence Phase C - turns an already-computed DiarizationFeatures
// (produced by @speedora/speaker-diarization's deriveDiarizationFeatures(),
// re-run per-clip against the render graph's own clip-relative
// ctx.speakerTurns - see apps/worker's conversationDynamics render-graph
// node) into the conversation-dynamics metrics the brief's "Conversation
// Dynamics" section (12/13) asked for. Zero new detectors: every input
// here already exists on DiarizationFeatures.segments/turnCount/
// switchCount/overlappingSpeech.
//
// Not calibrated against real engagement data - see conversation-
// intelligence.ts's own header comment on interactionIntensity's "scale
// honesty" caveat.

// Turns/minute treated as "as fast as real rapid back-and-forth exchange
// gets" for interactionIntensity's normalization - not derived from any
// dataset (there isn't one yet), a deliberately round, documented ceiling
// in the same spirit as this codebase's other uncalibrated heuristic
// constants.
const INTERACTION_TURN_DENSITY_CEILING_PER_MINUTE = 20;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Merges possibly-overlapping intervals before summing, so a 3-way overlap
// at the same instant (two separate pairwise OverlappingSpeechInterval
// entries covering the same seconds) isn't double-counted into a ratio
// that could exceed 1.
function mergedDurationSeconds(intervals: Array<{ start: number; end: number }>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      total += current.end - current.start;
      current = { ...next };
    }
  }
  total += current.end - current.start;
  return total;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function deriveConversationDynamics(
  features: DiarizationFeatures,
  clipDurationSeconds: number,
): ConversationDynamics {
  const durations = features.segments.map((segment) => segment.durationSeconds);
  const turnDensityPerMinute =
    clipDurationSeconds > 0 ? features.turnCount / (clipDurationSeconds / 60) : 0;

  const backAndForthScore =
    features.turnCount >= 2 ? features.switchCount / (features.turnCount - 1) : null;

  const responseGaps: number[] = [];
  for (let i = 1; i < features.segments.length; i++) {
    const previous = features.segments[i - 1];
    const current = features.segments[i];
    if (current.speaker !== previous.speaker) {
      responseGaps.push(Math.max(0, current.start - previous.end));
    }
  }
  const responseLatencySeconds = mean(responseGaps);

  const overlapSeconds = mergedDurationSeconds(features.overlappingSpeech);
  const overlapRatio = clipDurationSeconds > 0 ? clamp01(overlapSeconds / clipDurationSeconds) : 0;

  const normalizedTurnDensity = clamp01(
    turnDensityPerMinute / INTERACTION_TURN_DENSITY_CEILING_PER_MINUTE,
  );
  const interactionIntensity = clamp01(
    0.4 * normalizedTurnDensity + 0.4 * (backAndForthScore ?? 0) + 0.2 * overlapRatio,
  );

  return {
    speakerCount: features.speakerCount,
    turnCount: features.turnCount,
    switchCount: features.switchCount,
    turnDensityPerMinute,
    averageTurnDurationSeconds: mean(durations),
    medianTurnDurationSeconds: median(durations),
    backAndForthScore,
    responseLatencySeconds,
    overlapRatio,
    interactionIntensity,
  };
}
