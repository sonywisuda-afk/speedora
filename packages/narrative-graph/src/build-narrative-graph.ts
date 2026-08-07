import type {
  NarrativeGraph,
  NarrativeGraphDetectionSegment,
  SemanticEvent,
} from '@speedora/contracts';
import type { StructuredCallDeps } from '@speedora/llm-client';
import { extractRawGraph } from './extract-raw-graph';
import { validateGraph } from './validate-graph';

export interface BuildNarrativeGraphInput {
  segments: NarrativeGraphDetectionSegment[];
  semanticEvents: SemanticEvent[] | null;
  clipDurationSeconds: number;
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - orchestrates the one LLM call (extractRawGraph) plus a pure
// structural-validation step (validateGraph) into one NarrativeGraph. Same
// "adapter narrows ctx data, module owns the multi-step orchestration"
// shape as hook-prediction's predict-hook.ts / semantic-events'
// detect-semantic-events.ts.
export async function buildNarrativeGraph(
  input: BuildNarrativeGraphInput,
  deps: StructuredCallDeps,
): Promise<NarrativeGraph> {
  const raw = await extractRawGraph(input.segments, input.semanticEvents, deps);
  return validateGraph(raw, input.clipDurationSeconds);
}
