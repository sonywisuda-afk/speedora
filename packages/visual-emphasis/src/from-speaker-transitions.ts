import type { EditingSuggestion, SpeakerTurn } from '@speedora/contracts';
import { deriveConversationDynamics } from '@speedora/conversation-intelligence';
import { deriveDiarizationFeatures } from '@speedora/speaker-diarization';

// Speaker Intelligence Phase E ("speaker_focus_shift" - see docs/ai/
// speaker-intelligence.md). Reuses Phase C's own already-shipped functions
// verbatim (deriveDiarizationFeatures/deriveConversationDynamics) - zero new
// detector, zero new heuristic composite beyond the gates below. Deliberately
// NOT a replacement for fromPrimarySubjectSamples() (the existing, purely
// visual-track-based focus_shift source) - a genuine speaker change can
// happen with no visual trackId change at all (e.g. two speakers sharing one
// frame, or the tracker never losing the shot), which the visual detector
// structurally cannot see. This is a second, independent EVIDENCE source for
// the same real-world event ("the camera should acknowledge someone else is
// now talking"), not a second reframing mechanism - the suggestions this
// produces flow into the exact same buildCropPath()/applyFocusShifts()
// pipeline @speedora/reframe already has, completely unchanged.
//
// The user's own explicit warning drove this file's design: "setiap
// pergantian speaker = kamera pindah" (every speaker switch = camera cut) is
// NOT the goal - a podcast/interview can switch speaker several times a
// SECOND during a rapid exchange, and triggering a crop snap on every one of
// those would read as jittery, not "speaker-aware." Three independent gates,
// all needed together:
//
// 1. MIN_SPEAKER_HOLD_SECONDS - a transition only counts if BOTH the
//    outgoing and incoming turn held the floor long enough to read as a
//    deliberate exchange, not a quick interjection/backchannel ("mm-hmm",
//    "right") or a diarization turn-split artifact. Same concept, same
//    numeric value, as fromPrimarySubjectSamples()'s own MIN_HOLD_SECONDS -
//    kept as an independent local constant (not imported) since these are
//    two different signals that happen to agree on a sensible floor, not one
//    shared threshold that would couple their tuning together.
// 2. MIN_TRANSITION_CONFIDENCE (adaptively raised by the clip's own
//    interactionIntensity) - a per-transition "how deliberate does this
//    read" score, and a clip-level damper reusing Phase C's own
//    interactionIntensity composite directly: a clip that is ALREADY
//    rapid-exchange overall (podcast/interview cross-talk) must clear a
//    higher bar per transition before it's considered shift-worthy, rather
//    than firing on every transition a merely-adequate-length hold clears.
// 3. MIN_SUGGESTION_GAP_SECONDS - a cooldown after each ACCEPTED suggestion
//    (not merely-candidate transitions) - even individually well-gated
//    transitions clustered a few seconds apart would still read as jittery
//    if every one of them snapped the crop; this enforces real spacing
//    between actual shifts.
//
// Fires 'speaker_focus_shift' (a SEPARATE technique value from
// 'focus_shift' - see the contract's own comment) specifically so
// render-clip.worker.ts can gate this source with its own independent flag,
// same "one flag per trigger source" precedent Digital Push (C4) already
// established when it extended Auto Zoom's own trigger set.

const MIN_SPEAKER_HOLD_SECONDS = 1.0;
const HOLD_CONFIDENCE_NORMALIZATION_SECONDS = 3.0;
const MIN_TRANSITION_CONFIDENCE = 0.5;
// How much MIN_TRANSITION_CONFIDENCE rises as interactionIntensity climbs
// from 0 to 1 - a documented HEURISTIC (ADR D4, "scale honesty"), not
// calibrated against real engagement data, same convention as every other
// numeric constant in this package.
const INTERACTION_INTENSITY_CONFIDENCE_PENALTY = 0.3;
const MIN_SUGGESTION_GAP_SECONDS = 4.0;
// Mirrors fromPrimarySubjectSamples()'s own FOCUS_SHIFT_WINDOW_SECONDS - a
// small symmetric window around the transition instant, keeping
// EditingSuggestion's [start, end] shape consistent for downstream
// consumers rather than a degenerate start === end range.
const FOCUS_SHIFT_WINDOW_SECONDS = 0.3;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function fromSpeakerTransitions(
  speakerTurns: SpeakerTurn[],
  clipDurationSeconds: number,
): EditingSuggestion[] {
  const features = deriveDiarizationFeatures(speakerTurns);
  const { interactionIntensity } = deriveConversationDynamics(features, clipDurationSeconds);
  const effectiveMinConfidence = clamp01(
    MIN_TRANSITION_CONFIDENCE + interactionIntensity * INTERACTION_INTENSITY_CONFIDENCE_PENALTY,
  );

  const suggestions: EditingSuggestion[] = [];
  let lastSuggestionEnd: number | null = null;

  for (let i = 1; i < features.segments.length; i++) {
    const previous = features.segments[i - 1];
    const current = features.segments[i];
    if (current.speaker === previous.speaker) continue; // not a genuine transition

    const outgoingHold = previous.durationSeconds;
    const incomingHold = current.durationSeconds;
    if (outgoingHold < MIN_SPEAKER_HOLD_SECONDS || incomingHold < MIN_SPEAKER_HOLD_SECONDS) {
      continue;
    }

    const confidence = clamp01(
      Math.min(outgoingHold, incomingHold) / HOLD_CONFIDENCE_NORMALIZATION_SECONDS,
    );
    if (confidence < effectiveMinConfidence) continue;

    const instant = current.start;
    if (lastSuggestionEnd !== null && instant - lastSuggestionEnd < MIN_SUGGESTION_GAP_SECONDS) {
      continue;
    }

    const end = instant + FOCUS_SHIFT_WINDOW_SECONDS / 2;
    suggestions.push({
      technique: 'speaker_focus_shift',
      start: Math.max(0, instant - FOCUS_SHIFT_WINDOW_SECONDS / 2),
      end,
      score: confidence,
      reason: `Speaker changed after both sides held the floor for at least ${Math.min(outgoingHold, incomingHold).toFixed(1)}s`,
    });
    lastSuggestionEnd = end;
  }

  return suggestions;
}
