import {
  editorialDecisionSchema,
  type BoundaryNudge,
  type ClipScores,
  type EditingSuggestion,
  type EditorialCategory,
  type EditorialDecision,
  type NarrativeGraph,
  type NegativeSignal,
  type RetentionPoint,
  type SemanticEvent,
} from '@speedora/contracts';
import {
  composeEditorialScore,
  computeCategoryConfidence,
  deriveEditorialCategories,
} from './compose-editorial-score';
import { detectContextDependency } from './detect-context-dependency';
import {
  detectAbruptEnding,
  detectConfusion,
  detectDeadAir,
  detectIncompleteThought,
  detectOverEditingRisk,
  detectPayoffMissing,
  detectSetupTooLong,
  detectVisualInstability,
} from './detect-negative-signals';
import { nudgeCandidateBoundary } from './nudge-boundaries';
import { RENDER_CATEGORY_WEIGHTS, SHORTLIST_CATEGORY_WEIGHTS } from './weights';

// The module's two entry points (ARCHITECTURE.md's JSON-contract module
// checklist) - both pure and synchronous, no `deps` parameter, no LLM call
// (every input is already computed elsewhere - Stage B's own two transcript
// -only LLM calls for shortlist mode, the render graph's grounded v4 nodes
// for render mode). See docs/ai/editorial-director.md for the full design.

export interface ComputeEditorialDecisionForShortlistInput {
  scores: ClipScores;
  narrativeGraph: NarrativeGraph | null;
  semanticEvents: SemanticEvent[] | null;
  // Clip-relative text of this candidate's own first/last transcript
  // segment - used by nudge-boundaries.ts's lexical mid-sentence check.
  firstSegmentText: string;
  lastSegmentText: string;
  // This candidate's own full transcript text, joined - used by
  // detectContextDependency (opening pronoun scan) and, by the caller, for
  // cross-candidate redundancy comparison (DiversityCandidate.text).
  fullText: string;
  // Video-absolute seconds - passed straight through into BoundaryNudge's
  // original/suggested fields, never recomputed.
  candidateStartTime: number;
  candidateEndTime: number;
  maxBoundaryExpansionSeconds?: number;
}

export interface ComputeEditorialDecisionForShortlistResult {
  decision: EditorialDecision;
  nudge: BoundaryNudge | null;
}

// mode: 'shortlist' - runs pre-render inside @speedora/candidate-shortlist,
// using only ungrounded/transcript-only signals. negativeSignals here
// deliberately EXCLUDES `redundancy` (a cross-candidate comparison this
// single-candidate function has no visibility into) and `visualInstability`/
// `overEditingRisk` (need editingSuggestions, which don't exist pre-render)
// - the caller merges a `redundancy` signal in afterward via
// mergeNegativeSignal(), once selectDiverseShortlist() has picked the final
// survivors (see @speedora/editorial-director's compute-candidate-
// similarity.ts).
export function computeEditorialDecisionForShortlist(
  input: ComputeEditorialDecisionForShortlistInput,
): ComputeEditorialDecisionForShortlistResult {
  const clipDurationSeconds = input.candidateEndTime - input.candidateStartTime;

  const categories = deriveEditorialCategories({
    mode: 'shortlist',
    scores: input.scores,
    narrativeGraph: input.narrativeGraph,
  });

  const negativeSignals: NegativeSignal[] = [
    detectContextDependency(input.fullText, null),
    detectDeadAir(input.narrativeGraph, input.semanticEvents?.length ?? null, null),
    detectConfusion(input.narrativeGraph, null),
    detectIncompleteThought(input.narrativeGraph),
    detectAbruptEnding(input.narrativeGraph, clipDurationSeconds),
    detectSetupTooLong(input.narrativeGraph, clipDurationSeconds),
    detectPayoffMissing(input.narrativeGraph),
  ];

  const editorialScore = composeEditorialScore(
    categories,
    negativeSignals,
    SHORTLIST_CATEGORY_WEIGHTS,
  );
  const confidence = computeCategoryConfidence(categories);

  const nudge = nudgeCandidateBoundary(
    input.narrativeGraph,
    input.firstSegmentText,
    input.lastSegmentText,
    input.candidateStartTime,
    input.candidateEndTime,
    input.maxBoundaryExpansionSeconds,
  );

  const decision = editorialDecisionSchema.parse({
    mode: 'shortlist',
    editorialScore,
    categories,
    negativeSignals,
    boundaryNudge: nudge,
    confidence,
  });

  return { decision, nudge };
}

export interface ComputeEditorialDecisionForRenderInput {
  scores: ClipScores;
  // This clip's own full transcript text - render-clip.worker.ts's own
  // `transcript` is already clip-scoped (confirmed against the real code:
  // toAudioActivityWindows()/toSpeakerTurns() both map it directly with no
  // endTime filter), so no re-slicing is needed here.
  text: string;
  namedEntities: string[];
  narrativeGraph: NarrativeGraph | null;
  semanticEvents: SemanticEvent[] | null;
  hookProbability: number | null;
  topicShiftScore: number | null;
  // RetentionCurveInsights.dropPoints - always a real (possibly empty)
  // array in render mode, never null (RetentionCurveInsights is a pure,
  // zero-LLM derive that always runs).
  dropPoints: RetentionPoint[];
  // Peak EmotionalArc.intensity (0-1) within this clip, or null when the
  // clip has zero classified emotion samples.
  emotionalArcPeakIntensity: number | null;
  editingSuggestions: EditingSuggestion[];
  clipDurationSeconds: number;
  // 0-100, null when speakerCount <= 1 - not a low score, conversational
  // clarity simply isn't a meaningful axis for a solo clip.
  speakerClarityScore: number | null;
}

// mode: 'render' - runs post-render inside render-clip.worker.ts, right
// after the render graph resolves, using the full GROUNDED v4 signals plus
// editingSuggestions density/clustering. Computed ALWAYS (cheap, pure, no
// I/O) regardless of EDITORIAL_DIRECTOR_ENABLED - the flag gates future API
// exposure only (ADR D8), not computation, same posture as every other v4
// render-graph node. Scoring/observability only this phase - does not gate
// or reject rendering (boundaryNudge is always null here; Phase A does not
// re-cut a clip post-render, a user-confirmed scope decision).
export function computeEditorialDecisionForRender(
  input: ComputeEditorialDecisionForRenderInput,
): EditorialDecision {
  const categories = deriveEditorialCategories({
    mode: 'render',
    scores: input.scores,
    narrativeGraph: input.narrativeGraph,
    hookProbability: input.hookProbability,
    emotionalArcPeakIntensity: input.emotionalArcPeakIntensity,
    editingSuggestionScores: input.editingSuggestions.map((suggestion) => suggestion.score),
    speakerClarityScore: input.speakerClarityScore,
  });

  const negativeSignals: NegativeSignal[] = [
    detectContextDependency(input.text, input.namedEntities),
    detectDeadAir(input.narrativeGraph, input.semanticEvents?.length ?? null, input.dropPoints),
    detectConfusion(input.narrativeGraph, input.topicShiftScore),
    detectIncompleteThought(input.narrativeGraph),
    detectAbruptEnding(input.narrativeGraph, input.clipDurationSeconds),
    detectSetupTooLong(input.narrativeGraph, input.clipDurationSeconds),
    detectPayoffMissing(input.narrativeGraph),
    detectVisualInstability(input.editingSuggestions),
    detectOverEditingRisk(input.editingSuggestions, input.clipDurationSeconds),
  ];

  const editorialScore = composeEditorialScore(
    categories,
    negativeSignals,
    RENDER_CATEGORY_WEIGHTS,
  );
  const confidence = computeCategoryConfidence(categories);

  return editorialDecisionSchema.parse({
    mode: 'render',
    editorialScore,
    categories,
    negativeSignals,
    boundaryNudge: null,
    confidence,
  });
}

const MODE_WEIGHTS: Record<'shortlist' | 'render', Record<EditorialCategory, number>> = {
  shortlist: SHORTLIST_CATEGORY_WEIGHTS,
  render: RENDER_CATEGORY_WEIGHTS,
};

// Folds one additional NegativeSignal into an already-computed
// EditorialDecision and recomposes editorialScore - used by
// @speedora/candidate-shortlist to merge in `redundancy` (a cross-candidate
// comparison computeEditorialDecisionForShortlist can't see) once
// selectDiverseShortlist() has picked the final survivors. Replaces any
// existing signal of the same type rather than appending a duplicate (this
// is only ever called once per decision in the current wiring, but stays
// idempotent regardless).
export function mergeNegativeSignal(
  decision: EditorialDecision,
  signal: NegativeSignal,
): EditorialDecision {
  const negativeSignals = [
    ...decision.negativeSignals.filter((existing) => existing.type !== signal.type),
    signal,
  ];
  const weights = MODE_WEIGHTS[decision.mode];
  const editorialScore = composeEditorialScore(decision.categories, negativeSignals, weights);
  return editorialDecisionSchema.parse({ ...decision, negativeSignals, editorialScore });
}
