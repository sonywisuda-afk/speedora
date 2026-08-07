import type { HookPredictionInput, HookPredictionOutput } from '@speedora/contracts';
import type { StructuredCallDeps } from '@speedora/llm-client';
import { computeHookPrediction } from './compute-hook-prediction';
import { extractLinguisticFeatures } from './extract-linguistic-features';

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - orchestrates the one LLM call (extractLinguisticFeatures)
// plus a pure scoring step (computeHookPrediction) into one
// HookPredictionOutput. `input.pauseFeatures` arrives pre-assembled - see
// derive-pause-features.ts, which the adapter (apps/worker's render-graph
// node) calls as its own small step before this one, the same "adapter
// narrows ctx data, calls the pure piece it needs, then calls the module's
// main entry" shape as every other multi-step node group in render-graph
// (e.g. nodes/face-speaker.ts).
export async function predictHook(
  input: HookPredictionInput,
  deps: StructuredCallDeps,
): Promise<HookPredictionOutput> {
  const linguisticFeatures = await extractLinguisticFeatures(input.segments, deps);
  return computeHookPrediction(input, linguisticFeatures);
}
