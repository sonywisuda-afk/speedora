import type {
  ObjectTrack,
  OcrTextTrack,
  SemanticEvent,
  SemanticEventDetectionSegment,
} from '@speedora/contracts';
import type { StructuredCallDeps } from '@speedora/llm-client';
import { extractRawEvents } from './extract-raw-events';
import { groundEvents } from './ground-events';

export interface DetectSemanticEventsInput {
  segments: SemanticEventDetectionSegment[];
  ocrTracks: OcrTextTrack[];
  objectTracks: ObjectTrack[];
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - orchestrates the one LLM call (extractRawEvents) plus a
// pure grounding step (groundEvents) into a full SemanticEvent[]. Same
// "adapter narrows ctx data, module owns the multi-step orchestration"
// shape as hook-prediction's predict-hook.ts.
export async function detectSemanticEvents(
  input: DetectSemanticEventsInput,
  deps: StructuredCallDeps,
): Promise<SemanticEvent[]> {
  const rawEvents = await extractRawEvents(input.segments, deps);
  return groundEvents(rawEvents, input.ocrTracks, input.objectTracks);
}
