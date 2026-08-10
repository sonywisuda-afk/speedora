import type { SemanticEvent } from '@speedora/contracts';

// AI Intelligence v4 Clip Ranking Engine (spec Part 10 - see
// docs/ai/clip-ranking-engine.md) - see derive-narrative-graph-score.ts's
// own doc comment for why this lives here (shared by Phase 13.2 and Phase
// 14.1, this package has no `openai`/`llm-client` in its dependency tree,
// avoiding a real pnpm `injectWorkspacePackages` isolation bug).
//
// `null` means the LLM call failed - a neutral midpoint (50), not a
// penalty, same "an optional signal failing never counts against a
// candidate" convention as every render-graph node's own fallback: null.
// A real empty result (the model ran and found nothing significant) is
// different information than a failure and scores below neutral, not at
// it. The formula is agnostic to grounding richness - it only reads
// type/importance, both present either way - so the same function is
// valid for Stage B's ungrounded pre-render pass and Stage D's grounded
// post-render one.
export function deriveSemanticEventsScore(events: SemanticEvent[] | null): number {
  if (events === null) return 50;
  if (events.length === 0) return 20;
  const averageImportance =
    events.reduce((sum, event) => sum + event.importance, 0) / events.length;
  return averageImportance * 100;
}
