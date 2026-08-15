import type { NarrativeGraph } from '@speedora/contracts';

const CONTEXT_SEGMENT_TYPES = new Set(['setup', 'context']);
const NO_SEGMENT_SCORE = 30;
const BASELINE_SCORE = 50;

// Structural read of NarrativeGraph - does a setup/context segment exist,
// how confident is the LLM about it. Deliberately distinct BY METHOD from
// detect-context-dependency.ts's `contextDependency` penalty (a lexical
// pronoun/antecedent scan over raw text) - splitting these by method, not
// just by name, avoids recreating the exact hidden-ancestor bug the
// clip-ranking audit found (the same underlying detector silently feeding a
// composite 2-3 times under different field names). If the two end up
// correlated in practice (a clip missing a setup segment often also opens
// with an unresolved pronoun), that's expected and fine - the goal here is
// to avoid a SHARED ancestor computation, not to guarantee zero statistical
// correlation between every pair of signals.
//
// Works identically in both modes (NarrativeGraph's shape is the same
// ungrounded/grounded) - baseline (neutral) when no graph is available at
// all, since "unknown" should never read as "bad."
export function deriveContextCompletenessScore(narrativeGraph: NarrativeGraph | null): number {
  if (narrativeGraph == null || narrativeGraph.unsegmented) return BASELINE_SCORE;
  const contextSegments = narrativeGraph.segments.filter((segment) =>
    CONTEXT_SEGMENT_TYPES.has(segment.type),
  );
  if (contextSegments.length === 0) return NO_SEGMENT_SCORE;
  const averageConfidence =
    contextSegments.reduce((sum, segment) => sum + segment.confidence, 0) / contextSegments.length;
  return Math.round(BASELINE_SCORE + averageConfidence * BASELINE_SCORE);
}
