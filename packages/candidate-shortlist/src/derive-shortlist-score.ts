import type { ClipScores, NarrativeGraph, SemanticEvent } from '@speedora/contracts';
import { deriveNarrativeGraphScore, deriveSemanticEventsScore } from '@speedora/virality-engine';

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

// Semantic Importance and Narrative (Tier 2, cheap transcript-only LLM
// calls) - both formulas now live in @speedora/virality-engine
// (deriveSemanticEventsScore/deriveNarrativeGraphScore), not here. AI
// Intelligence v4 Phase 14.1 follow-up fix: they were originally defined
// in THIS package and exported for Phase 14.1's `@speedora/clip-ranking`
// to reuse, but that created a real, CI-reproduced bug - this package
// transitively depends on `openai` (via @speedora/llm-client), and pnpm's
// `injectWorkspacePackages: true` isolates any workspace package that
// touches openai's own peer-dependency-affected resolution when it's
// depended on by a THIRD sibling package with no openai anchor of its own
// (clip-ranking) - the injected copy silently never gets its `dist/`
// populated by a plain `pnpm --filter "./packages/**" build` (see
// docs/ai/clip-ranking-engine.md's Phase 14.1 CI-fix note for the full
// diagnosis). @speedora/virality-engine has no openai/llm-client anywhere
// in its own dependency tree, so it doesn't trigger this - moving the
// functions there (which this package already depended on for
// isPayoffSegmentType) fixes the root cause rather than working around
// the symptom.

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
