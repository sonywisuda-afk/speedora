import type { ObjectTrack, OcrTextTrack, SemanticEvent } from '@speedora/contracts';
import { findConcurrentEvidence } from '@speedora/multimodal-reasoning';
import { describeEventType } from './describe-event-type';
import type { RawSemanticEvent } from './extract-raw-events';

// How far around an event's own `t` counts as "concurrent" on-screen
// evidence - tighter than hook-prediction's HOOK_WINDOW_SECONDS since this
// is asking "was this literally visible right then", not "somewhere near
// the opening". Not derived from any real data (ADR D4).
const GROUNDING_WINDOW_SECONDS = 2;

// Pure post-processing step (ADR D2 - no LLM/DB access) - attaches
// on-screen evidence to each already-detected event via
// @speedora/multimodal-reasoning's findConcurrentEvidence, and falls back
// to a generic per-type description when the LLM returned an empty
// `reason` (belt-and-suspenders, same defensive posture as every other
// LLM-output sanitization step in this codebase).
export function groundEvents(
  events: RawSemanticEvent[],
  ocrTracks: OcrTextTrack[],
  objectTracks: ObjectTrack[],
): SemanticEvent[] {
  return events.map((event) => ({
    ...event,
    reason: event.reason.length > 0 ? event.reason : describeEventType(event.type),
    evidence: findConcurrentEvidence(event.t, GROUNDING_WINDOW_SECONDS, ocrTracks, objectTracks),
  }));
}
