import type { ClipScores, NarrativeGraph, SemanticEvent } from '@speedora/contracts';
import { isPayoffSegmentType } from '@speedora/virality-engine';

export interface DeriveShortlistScoreInput {
  scores: ClipScores;
  viralityScore: number;
  semanticEvents: SemanticEvent[] | null;
  narrativeGraph: NarrativeGraph | null;
}

// Weights sum to 1 - HEURISTIC (ADR D4, docs/coding-standards.md's "scale
// honesty"), unvalidated against real engagement data, same caveat every
// other v4 composite (Virality Engine, Editing Rhythm, ...) already
// carries. `llmScore` gets the largest share since it's the only Tier-1
// (free, already-paid-for) signal - the two Tier-2 signals are new cost
// this phase introduces specifically to add information the LLM candidate
// scoring pass doesn't have (detected narrative events/structure), so they
// stay a meaningful but smaller share until real data can calibrate this.
const LLM_SCORE_WEIGHT = 0.5;
const SEMANTIC_SCORE_WEIGHT = 0.25;
const NARRATIVE_SCORE_WEIGHT = 0.25;

// Tier 1 (free): already-computed LLM candidate scores. Averages ALL of
// ClipScores' fields rather than cherry-picking a subset - avoids having
// to defend an arbitrary "these dimensions matter more" choice, and stays
// correct automatically if ClipScores grows a new field later.
function averageClipScores(scores: ClipScores): number {
  const values = Object.values(scores);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function llmScore(scores: ClipScores, viralityScore: number): number {
  return (viralityScore + averageClipScores(scores)) / 2;
}

// Semantic Importance (Tier 2, cheap transcript-only LLM call). `null`
// means the LLM call failed - a neutral midpoint (50), not a penalty, same
// "an optional signal failing never counts against a candidate" convention
// as every render-graph node's own fallback: null. A real empty result
// (the model ran and found nothing significant) is different information
// than a failure and scores below neutral, not at it.
//
// Exported (not module-private) - AI Intelligence v4 Phase 14.1 (Clip
// Ranking Engine, Stage D - see docs/ai/clip-ranking-engine.md) reuses this
// exact formula to score Stage C's GROUNDED SemanticEvent[] post-render,
// rather than duplicating the heuristic. The formula itself is agnostic to
// grounding richness - it only reads type/importance, both present either
// way - so the same function is valid for both an ungrounded pre-render
// pass (this package's own selectShortlist()) and a grounded post-render
// one. Phase 14.1 handles its own null-vs-neutral semantics differently
// (excludes a null input from its composite entirely rather than scoring
// it 50) - by simply not calling this function when its own input is
// null, not by changing this function's behavior.
export function deriveSemanticEventsScore(events: SemanticEvent[] | null): number {
  if (events === null) return 50;
  if (events.length === 0) return 20;
  const averageImportance =
    events.reduce((sum, event) => sum + event.importance, 0) / events.length;
  return averageImportance * 100;
}

// Narrative (Tier 2, cheap transcript-only LLM call). `null` means the LLM
// call failed - same neutral-midpoint reasoning as above.
// `unsegmented: true` is a REAL, successful result (validateGraph()'s own
// structural fallback - see NarrativeGraph's doc comment in
// packages/contracts/src/narrative-graph.ts), not a failure, but it does
// mean this candidate has no clean detected story arc - scored below
// neutral, not zero (an unsegmented clip can still be a good candidate for
// reasons this signal alone can't see). A segmented graph scores on two
// things: average segment-type confidence (the LLM's own certainty in its
// structure) and whether any segment reaches a payoff type
// (isPayoffSegmentType(), reused from @speedora/virality-engine rather
// than re-implemented) - a narrative that never resolves is weaker even if
// well-segmented.
//
// Exported for the same Phase 14.1 reuse reason as
// deriveSemanticEventsScore above.
export function deriveNarrativeGraphScore(graph: NarrativeGraph | null): number {
  if (graph === null) return 50;
  if (graph.unsegmented || graph.segments.length === 0) return 40;
  const averageConfidence =
    graph.segments.reduce((sum, segment) => sum + segment.confidence, 0) / graph.segments.length;
  const hasPayoff = graph.segments.some((segment) => isPayoffSegmentType(segment.type));
  return averageConfidence * 60 + (hasPayoff ? 40 : 0);
}

// Pure, synchronous composite - the module's own scoring step, separate
// from the async orchestration (select-shortlist.ts) that gathers its
// inputs. Bounded to [0, 100] since it's a convex combination (weights sum
// to 1) of three already-[0, 100] sub-scores.
export function deriveShortlistScore(input: DeriveShortlistScoreInput): number {
  return (
    llmScore(input.scores, input.viralityScore) * LLM_SCORE_WEIGHT +
    deriveSemanticEventsScore(input.semanticEvents) * SEMANTIC_SCORE_WEIGHT +
    deriveNarrativeGraphScore(input.narrativeGraph) * NARRATIVE_SCORE_WEIGHT
  );
}
