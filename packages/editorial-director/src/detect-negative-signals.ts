import type {
  EditingSuggestion,
  EditingTechnique,
  NarrativeGraph,
  NegativeSignal,
  RetentionPoint,
} from '@speedora/contracts';
import { hasUnresolvedTension, isPayoffSegmentType } from '@speedora/virality-engine';
import { PENALTY_CAPS } from './weights';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasSegments(narrativeGraph: NarrativeGraph | null): narrativeGraph is NarrativeGraph {
  return (
    narrativeGraph != null && !narrativeGraph.unsegmented && narrativeGraph.segments.length > 0
  );
}

// Section 7 (Negative Intelligence) of the mission - "what makes this clip
// bad?", not just "what is good?". One detector per named penalty type
// (contextDependency lives in its own file, detect-context-dependency.ts -
// it needed more lexical machinery than the others below). Every detector
// returns penalty: 0 (a real, common result, not an absence) when its own
// signal genuinely doesn't fire, and is null-safe against unavailable
// upstream data (never fabricates a penalty from missing data).

// --- deadAir --------------------------------------------------------------

const DEAD_AIR_PROXY_PENALTY = 10;

// Render mode passes real, grounded dropPoints (RetentionCurveInsights,
// already grounded via Contextual Momentum) - each point's own `score` IS
// the drop's severity (0-1), same convention @speedora/clip-ranking's own
// retentionScore already reuses. Shortlist mode has no momentum data
// pre-render (dropPoints: null) and falls back to a documented WEAK proxy:
// an unsegmented narrative graph or zero detected semantic events
// correlates with, but does not prove, low-energy content.
export function detectDeadAir(
  narrativeGraph: NarrativeGraph | null,
  semanticEventCount: number | null,
  dropPoints: RetentionPoint[] | null,
): NegativeSignal {
  if (dropPoints !== null) {
    if (dropPoints.length === 0) {
      return { type: 'deadAir', penalty: 0, reason: 'No momentum drop points detected.' };
    }
    const severity = average(dropPoints.map((point) => point.score));
    const penalty = clamp(severity, 0, 1) * PENALTY_CAPS.deadAir;
    return {
      type: 'deadAir',
      penalty,
      reason: `Momentum drop points detected (average severity ${(severity * 100).toFixed(0)}%) - the clip may have stretches with little forward energy.`,
    };
  }

  const unsegmented = narrativeGraph != null && narrativeGraph.unsegmented;
  const noEvents = semanticEventCount === 0;
  if (!unsegmented && !noEvents) {
    return {
      type: 'deadAir',
      penalty: 0,
      reason: 'No pre-render proxy signal for low-energy content detected.',
    };
  }
  return {
    type: 'deadAir',
    penalty: DEAD_AIR_PROXY_PENALTY,
    reason:
      'No clear narrative structure or notable events detected pre-render - a WEAK proxy for low-energy content (grounded momentum data is only available post-render).',
  };
}

// --- confusion --------------------------------------------------------------

const CONFUSION_TOPIC_SHIFT_WEIGHT = 0.3;

// The narrative LLM's own uncertainty about segment classification, as a
// proxy for "this may read as confusing." Render mode adds hookPrediction's
// already-computed topicShiftScore as a second contributor.
export function detectConfusion(
  narrativeGraph: NarrativeGraph | null,
  topicShiftScore: number | null,
): NegativeSignal {
  const parts: number[] = [];
  if (hasSegments(narrativeGraph)) {
    const averageConfidence = average(narrativeGraph.segments.map((segment) => segment.confidence));
    parts.push(1 - averageConfidence);
  }
  if (topicShiftScore !== null) {
    parts.push(topicShiftScore * CONFUSION_TOPIC_SHIFT_WEIGHT);
  }
  if (parts.length === 0) {
    return { type: 'confusion', penalty: 0, reason: 'No confusion signal available.' };
  }
  const severity = clamp(average(parts), 0, 1);
  const penalty = severity * PENALTY_CAPS.confusion;
  return {
    type: 'confusion',
    penalty,
    reason:
      penalty > 0
        ? `Narrative structure/topic signals suggest some potential for viewer confusion (severity ${(severity * 100).toFixed(0)}%).`
        : 'Narrative structure reads clearly.',
  };
}

// --- incompleteThought ------------------------------------------------------

// Reuses @speedora/virality-engine's hasUnresolvedTension() - a
// conflict/escalation segment with no `resolves` relation reads as an open
// loop the clip never closes.
export function detectIncompleteThought(narrativeGraph: NarrativeGraph | null): NegativeSignal {
  if (!hasSegments(narrativeGraph)) {
    return {
      type: 'incompleteThought',
      penalty: 0,
      reason: 'No narrative structure available to evaluate.',
    };
  }
  if (!hasUnresolvedTension(narrativeGraph)) {
    return { type: 'incompleteThought', penalty: 0, reason: 'No unresolved tension detected.' };
  }
  return {
    type: 'incompleteThought',
    penalty: PENALTY_CAPS.incompleteThought,
    reason:
      'A conflict/escalation segment has no resolving relation - the clip may leave a thought unfinished.',
  };
}

// --- abruptEnding ------------------------------------------------------------

const ABRUPT_ENDING_EPSILON_SECONDS = 1.5;

// The clip's last segment (by endTime) is a non-payoff type AND ends within
// ABRUPT_ENDING_EPSILON_SECONDS of the clip's own boundary - the clip was
// cut off mid-segment, not at a natural conclusion.
export function detectAbruptEnding(
  narrativeGraph: NarrativeGraph | null,
  clipDurationSeconds: number,
): NegativeSignal {
  if (!hasSegments(narrativeGraph)) {
    return {
      type: 'abruptEnding',
      penalty: 0,
      reason: 'No narrative structure available to evaluate.',
    };
  }
  const lastSegment = [...narrativeGraph.segments].sort((a, b) => b.endTime - a.endTime)[0];
  const endsNearClipEnd =
    clipDurationSeconds - lastSegment.endTime <= ABRUPT_ENDING_EPSILON_SECONDS;
  if (!endsNearClipEnd || isPayoffSegmentType(lastSegment.type)) {
    return {
      type: 'abruptEnding',
      penalty: 0,
      reason: 'Clip ends on a payoff-bearing segment, or well before its own boundary.',
    };
  }
  return {
    type: 'abruptEnding',
    penalty: PENALTY_CAPS.abruptEnding,
    reason: `Clip ends mid-"${lastSegment.type}" segment, close to its own boundary - may read as cut off before a natural conclusion.`,
  };
}

// --- setupTooLong ------------------------------------------------------------

const SETUP_TOO_LONG_THRESHOLD = 0.4;
const SETUP_SEGMENT_TYPES = new Set(['hook', 'setup', 'context']);

// Sum of leading hook/setup/context segment durations (before the first
// non-setup segment) as a fraction of total clip duration - penalty scales
// linearly once that fraction exceeds SETUP_TOO_LONG_THRESHOLD.
export function detectSetupTooLong(
  narrativeGraph: NarrativeGraph | null,
  clipDurationSeconds: number,
): NegativeSignal {
  if (!hasSegments(narrativeGraph) || clipDurationSeconds <= 0) {
    return {
      type: 'setupTooLong',
      penalty: 0,
      reason: 'No narrative structure available to evaluate.',
    };
  }
  const sorted = [...narrativeGraph.segments].sort((a, b) => a.startTime - b.startTime);
  let setupDuration = 0;
  for (const segment of sorted) {
    if (!SETUP_SEGMENT_TYPES.has(segment.type)) break;
    setupDuration += Math.max(0, segment.endTime - segment.startTime);
  }
  const setupFraction = clamp(setupDuration / clipDurationSeconds, 0, 1);
  if (setupFraction <= SETUP_TOO_LONG_THRESHOLD) {
    return {
      type: 'setupTooLong',
      penalty: 0,
      reason: `Setup occupies ${(setupFraction * 100).toFixed(0)}% of the clip - within a reasonable range.`,
    };
  }
  const overage = clamp(
    (setupFraction - SETUP_TOO_LONG_THRESHOLD) / (1 - SETUP_TOO_LONG_THRESHOLD),
    0,
    1,
  );
  const penalty = overage * PENALTY_CAPS.setupTooLong;
  return {
    type: 'setupTooLong',
    penalty,
    reason: `Setup occupies ${(setupFraction * 100).toFixed(0)}% of the clip, beyond the ${(SETUP_TOO_LONG_THRESHOLD * 100).toFixed(0)}% guideline - value may arrive too late.`,
  };
}

// --- payoffMissing ------------------------------------------------------------

// Directly reuses isPayoffSegmentType + a `resolves` relation check - only
// flagged when the graph is genuinely segmented (never fabricates a penalty
// from an unsegmented/missing graph).
export function detectPayoffMissing(narrativeGraph: NarrativeGraph | null): NegativeSignal {
  if (!hasSegments(narrativeGraph)) {
    return {
      type: 'payoffMissing',
      penalty: 0,
      reason: 'No narrative structure available to evaluate.',
    };
  }
  const hasPayoff =
    narrativeGraph.relations.some((relation) => relation.type === 'resolves') ||
    narrativeGraph.segments.some((segment) => isPayoffSegmentType(segment.type));
  if (hasPayoff) {
    return {
      type: 'payoffMissing',
      penalty: 0,
      reason: 'A resolution/takeaway/cta segment or resolving relation was found.',
    };
  }
  return {
    type: 'payoffMissing',
    penalty: PENALTY_CAPS.payoffMissing,
    reason:
      'No resolution, takeaway, or call-to-action segment detected - the clip may not deliver on its own setup.',
  };
}

// --- visualInstability (render mode only) ------------------------------------

// The techniques that actually MOVE the crop window (not a static overlay
// like ocr_highlight, and not a purely temporal edit like reaction_hold/
// pause_hold) - directly operationalizes the existing Gate B integration
// audit's own documented "Focus Shift + Digital Push... no arbitration"
// finding (docs/ai/visual-emphasis-integration-audit.md) as a SCORE, without
// building the arbitration rule that audit explicitly deferred to Gate C.
const CROP_MOVING_TECHNIQUES = new Set<EditingTechnique>([
  'digital_push',
  'focus_shift',
  'speaker_focus_shift',
]);
const CLUSTER_WINDOW_SECONDS = 1.5;

export function detectVisualInstability(editingSuggestions: EditingSuggestion[]): NegativeSignal {
  const cropMoves = editingSuggestions
    .filter((suggestion) => CROP_MOVING_TECHNIQUES.has(suggestion.technique))
    .sort((a, b) => a.start - b.start);
  if (cropMoves.length < 2) {
    return {
      type: 'visualInstability',
      penalty: 0,
      reason: 'Fewer than 2 crop-moving suggestions - no clustering risk.',
    };
  }
  let clusteredPairs = 0;
  for (let i = 1; i < cropMoves.length; i += 1) {
    if (cropMoves[i].start - cropMoves[i - 1].end <= CLUSTER_WINDOW_SECONDS) clusteredPairs += 1;
  }
  if (clusteredPairs === 0) {
    return {
      type: 'visualInstability',
      penalty: 0,
      reason: 'Crop-moving suggestions are well spaced.',
    };
  }
  const severity = clamp(clusteredPairs / (cropMoves.length - 1), 0, 1);
  const penalty = severity * PENALTY_CAPS.visualInstability;
  return {
    type: 'visualInstability',
    penalty,
    reason: `${clusteredPairs} pair(s) of crop-moving suggestions (Focus Shift/Digital Push/Speaker Focus Shift) cluster within ${CLUSTER_WINDOW_SECONDS}s of each other - may read as visually unstable.`,
  };
}

// --- overEditingRisk (render mode only) ---------------------------------------

const OVER_EDITING_THRESHOLD_PER_MINUTE = 6;

// Suggestions-per-minute density, deliberately distinct from
// visualInstability's clustering statistic even though both read the same
// editingSuggestions array - a documented, deliberate, non-hidden reuse
// (same pattern platformFit/contentValue both reading ClipScores).
export function detectOverEditingRisk(
  editingSuggestions: EditingSuggestion[],
  clipDurationSeconds: number,
): NegativeSignal {
  if (clipDurationSeconds <= 0) {
    return { type: 'overEditingRisk', penalty: 0, reason: 'Clip duration unavailable.' };
  }
  const perMinute = editingSuggestions.length / (clipDurationSeconds / 60);
  if (perMinute <= OVER_EDITING_THRESHOLD_PER_MINUTE) {
    return {
      type: 'overEditingRisk',
      penalty: 0,
      reason: `${perMinute.toFixed(1)} suggestion(s)/min - within a reasonable density.`,
    };
  }
  const overage = clamp(
    (perMinute - OVER_EDITING_THRESHOLD_PER_MINUTE) / OVER_EDITING_THRESHOLD_PER_MINUTE,
    0,
    1,
  );
  const penalty = overage * PENALTY_CAPS.overEditingRisk;
  return {
    type: 'overEditingRisk',
    penalty,
    reason: `${perMinute.toFixed(1)} editing suggestions/min, above the ${OVER_EDITING_THRESHOLD_PER_MINUTE}/min guideline - may read as over-edited.`,
  };
}
