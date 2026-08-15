import type { NarrativeGraph } from '@speedora/contracts';

// Extracted out of compute-virality-prediction.ts's own computeCommentProbability
// (Phase 9) into its own file - Editorial Director Phase A's negative-signal
// detector `detectIncompleteThought` (@speedora/editorial-director) needed to
// reuse this exact predicate rather than re-implement it, same "small,
// dependency-free, reusable predicate" precedent is-payoff-segment-type.ts
// already set for the same reason. Non-breaking: compute-virality-prediction.ts
// now imports this instead of defining it locally, same behavior.
//
// A conflict/escalation segment with no `resolves` relation reads as
// "unresolved tension" - the kind of open loop that invites comments
// (agreement/disagreement/questions), distinct from hasPayoff().
export function hasUnresolvedTension(narrativeGraph: NarrativeGraph): boolean {
  const hasTensionSegment = narrativeGraph.segments.some(
    (segment) => segment.type === 'conflict' || segment.type === 'escalation',
  );
  const hasResolution = narrativeGraph.relations.some((relation) => relation.type === 'resolves');
  return hasTensionSegment && !hasResolution;
}
