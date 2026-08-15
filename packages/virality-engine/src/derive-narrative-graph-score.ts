import type { NarrativeGraph } from '@speedora/contracts';
import { isPayoffSegmentType } from './is-payoff-segment-type';

// AI Intelligence v4 Clip Ranking Engine (spec Part 10 - see
// docs/ai/clip-ranking-engine.md), shared by both Phase 13.2
// (@speedora/candidate-shortlist's pre-render, ungrounded pass) and Phase
// 14.1 (@speedora/clip-ranking's post-render, grounded pass). Lives here
// rather than in either of those two packages specifically because this
// package has no `openai`/`llm-client` anywhere in its own dependency
// tree - a real, CI-reproduced pnpm `injectWorkspacePackages` isolation
// bug surfaced when Phase 14.1 first depended on candidate-shortlist
// (which does transitively touch openai) purely to reuse this one pure
// function; relocating here instead of adding a workaround dependency
// fixes the root cause, not just the symptom. `isPayoffSegmentType` (this
// package's own Phase 9 export) already lived here, so this is also a
// natural co-location, not an arbitrary new home.
//
// `null` means the LLM call that would have produced this NarrativeGraph
// failed - a neutral midpoint (50), not a penalty, same "an optional
// signal failing never counts against a candidate" convention as every
// render-graph node's own fallback: null. `unsegmented: true` is a REAL,
// successful result (validateGraph()'s own structural fallback - see
// NarrativeGraph's doc comment in packages/contracts/src/
// narrative-graph.ts), not a failure, but it does mean this clip has no
// clean detected story arc - scored below neutral, not zero (it can still
// be a good candidate for reasons this signal alone can't see). A
// segmented graph scores on two things: average segment-type confidence
// (the LLM's own certainty in its structure) and whether any segment
// reaches a payoff type - a narrative that never resolves is weaker even
// if well-segmented.
//
// The formula is agnostic to whether the underlying detection was
// grounded - it only reads type/confidence, both present either way - so
// the same function is valid for Stage B's ungrounded pre-render pass and
// Stage D's grounded post-render one.
export function deriveNarrativeGraphScore(graph: NarrativeGraph | null): number {
  // Loose equality deliberately - the same `!= null` fix Phase 9's own
  // computeViralityPrediction() already needed (a render-graph mock/adapter
  // can hand back `undefined` for an unpopulated node, not just `null`; a
  // strict `=== null` check let that crash here instead of degrading to the
  // neutral midpoint - caught while wiring Editorial Director Phase A's own
  // render-mode call site against a real test fixture, see docs/ai/
  // editorial-director.md).
  if (graph == null) return 50;
  if (graph.unsegmented || graph.segments.length === 0) return 40;
  const averageConfidence =
    graph.segments.reduce((sum, segment) => sum + segment.confidence, 0) / graph.segments.length;
  const hasPayoff = graph.segments.some((segment) => isPayoffSegmentType(segment.type));
  return averageConfidence * 60 + (hasPayoff ? 40 : 0);
}
