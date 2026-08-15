import {
  shortlistCandidatesOutputSchema,
  type BoundaryNudge,
  type EditorialDecision,
  type NarrativeGraph,
  type SemanticEvent,
  type ShortlistCandidateInput,
  type ShortlistCandidatesInput,
  type ShortlistCandidatesOutput,
  type ShortlistDetectionSegment,
} from '@speedora/contracts';
import {
  computeEditorialDecisionForShortlist,
  detectRedundancy,
  isEditorialDirectorEnabled,
  mergeNegativeSignal,
  selectDiverseShortlist,
  type DiversityCandidate,
} from '@speedora/editorial-director';
import type { StructuredCallDeps } from '@speedora/llm-client';
import { buildNarrativeGraph } from '@speedora/narrative-graph';
import { detectSemanticEvents } from '@speedora/semantic-events';
import { deriveShortlistScore } from './derive-shortlist-score';

// AI Intelligence v4 Phase 13.2 (Clip Ranking Engine, Stage B - see
// docs/ai/clip-ranking-engine.md).

// The doc's own "~12-15" target, picked at the upper end since this
// composite is a heuristic, unvalidated pre-rank (see
// derive-shortlist-score.ts) - erring toward keeping more survivors is
// safer than being too aggressive on an uncalibrated cut. Overridable via
// ShortlistCandidatesInput.targetSize.
export const DEFAULT_SHORTLIST_TARGET_SIZE = 15;

// Bounds how many candidates' LLM calls run concurrently within one
// selectShortlist() call. Up to 30 candidates x 2 LLM calls each would
// otherwise fan out 30-wide from a single BullMQ job - a real rate-limit/
// cost-spike risk this codebase hasn't needed to guard against before
// (every prior v4 LLM call happens once per already-independent
// render-clip job, never fanned out within one job). A small fixed batch
// size rather than a full semaphore (apps/worker's own
// subprocessLimiter.ts pattern) - packages can't depend on apps/worker, and
// this is simple enough not to need one; revisit under real load if 5 turns
// out too conservative or too aggressive.
const LLM_CONCURRENCY = 5;

function toClipRelativeSegments(
  segments: ShortlistDetectionSegment[],
  startTime: number,
): { start: number; end: number; text: string }[] {
  return segments.map((segment) => ({
    start: segment.start - startTime,
    end: segment.end - startTime,
    text: segment.text,
  }));
}

interface CandidateScoreResult {
  semanticEvents: SemanticEvent[] | null;
  narrativeGraph: NarrativeGraph | null;
  preRankScore: number;
  // Editorial Director Phase A (docs/ai/editorial-director.md). Null when
  // EDITORIAL_DIRECTOR_ENABLED is off - the default, and this function's
  // exact pre-Phase-A behavior otherwise.
  editorialDecision: EditorialDecision | null;
  boundaryNudge: BoundaryNudge | null;
  fullText: string;
}

// Runs the two Stage B LLM calls for one candidate - best-effort, same
// "optional signal, never fail the caller" convention as every render-graph
// node's own fallback: null (nodes/hook-prediction.ts, nodes/
// semantic-events.ts, nodes/narrative-graph.ts). A failure in either call
// degrades that one candidate's composite score toward neutral (see
// derive-shortlist-score.ts) rather than failing the whole shortlist pass -
// one candidate's transient LLM failure should never cost every other
// candidate its shot at the shortlist.
async function scoreCandidate(
  candidate: ShortlistCandidateInput,
  deps: StructuredCallDeps,
): Promise<CandidateScoreResult> {
  const relativeSegments = toClipRelativeSegments(candidate.segments, candidate.startTime);

  // Un-grounded (no OCR/object tracks exist at this pre-render stage - see
  // this module's own package.json description / clip-ranking-engine.md).
  // Stage C's render-graph recomputes both WITH real grounding evidence
  // once a candidate survives to render; this pass only needs the event/
  // segment TYPES and confidence, not the grounding itself, to shortlist.
  const semanticEvents = await detectSemanticEvents(
    { segments: relativeSegments, ocrTracks: [], objectTracks: [] },
    deps,
  ).catch(() => null);

  const narrativeGraph = await buildNarrativeGraph(
    {
      segments: relativeSegments,
      semanticEvents,
      clipDurationSeconds: candidate.endTime - candidate.startTime,
    },
    deps,
  ).catch(() => null);

  const preRankScore = deriveShortlistScore({
    scores: candidate.scores,
    viralityScore: candidate.viralityScore,
    semanticEvents,
    narrativeGraph,
  });

  const fullText = relativeSegments.map((segment) => segment.text).join(' ');

  // Editorial Director Phase A - only ever runs on THIS path, which already
  // pays for the two LLM calls above (never inside selectShortlist()'s own
  // small-pool no-op branch below) - a user-confirmed scope decision that
  // adds zero new ongoing LLM cost this phase (see docs/ai/
  // editorial-director.md's own "Editorial Director cost scope" decision).
  let editorialDecision: EditorialDecision | null = null;
  let boundaryNudge: BoundaryNudge | null = null;
  if (isEditorialDirectorEnabled()) {
    const result = computeEditorialDecisionForShortlist({
      scores: candidate.scores,
      narrativeGraph,
      semanticEvents,
      firstSegmentText: relativeSegments[0]?.text ?? '',
      lastSegmentText: relativeSegments[relativeSegments.length - 1]?.text ?? '',
      fullText,
      candidateStartTime: candidate.startTime,
      candidateEndTime: candidate.endTime,
    });
    editorialDecision = result.decision;
    boundaryNudge = result.nudge;
  }

  return {
    semanticEvents,
    narrativeGraph,
    preRankScore,
    editorialDecision,
    boundaryNudge,
    fullText,
  };
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist). A no-op passthrough (every candidate survives, zero LLM
// calls, preRankScore still computed from Tier-1-only signals for output
// shape consistency) when the pool is already at or under the target - the
// common case today (Phase 13.1's CANDIDATE_EXPANSION_ENABLED off, or any
// explicit clipCount at or below the target) - so this phase adds no
// cost/behavior change unless a caller is actually asking for more
// candidates than the target.
export async function selectShortlist(
  input: ShortlistCandidatesInput,
  deps: StructuredCallDeps,
): Promise<ShortlistCandidatesOutput> {
  const targetSize = input.targetSize ?? DEFAULT_SHORTLIST_TARGET_SIZE;

  if (input.candidates.length <= targetSize) {
    // Editorial Director Phase A never runs here (the zero-LLM-call no-op
    // path) - see docs/ai/editorial-director.md's own cost-scope decision.
    return shortlistCandidatesOutputSchema.parse({
      shortlisted: input.candidates.map((candidate, index) => ({
        index,
        preRankScore: deriveShortlistScore({
          scores: candidate.scores,
          viralityScore: candidate.viralityScore,
          semanticEvents: null,
          narrativeGraph: null,
        }),
        semanticEvents: null,
        narrativeGraph: null,
        editorialDecision: null,
        boundaryNudge: null,
      })),
    });
  }

  const scored: (CandidateScoreResult & { index: number })[] = [];
  for (let i = 0; i < input.candidates.length; i += LLM_CONCURRENCY) {
    const batch = input.candidates.slice(i, i + LLM_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((candidate) => scoreCandidate(candidate, deps)),
    );
    batchResults.forEach((result, offset) => {
      scored.push({ index: i + offset, ...result });
    });
  }

  if (!isEditorialDirectorEnabled()) {
    const shortlisted = scored.sort((a, b) => b.preRankScore - a.preRankScore).slice(0, targetSize);
    return shortlistCandidatesOutputSchema.parse({
      shortlisted: shortlisted.map((entry) => ({
        ...entry,
        editorialDecision: null,
        boundaryNudge: null,
      })),
    });
  }

  // Editorial Director Phase A (docs/ai/editorial-director.md) -
  // diversity-aware re-selection (mission Section 8). `score` blends the
  // unchanged Tier-1/2 preRankScore (which alone already carries viralityScore
  // - editorialScore deliberately does NOT re-derive it, see
  // compose-editorial-score.ts's own category-to-source-signal mapping) with
  // EditorialDecision.editorialScore (which adds negative-signal penalties
  // preRankScore alone has no concept of) - averaging keeps BOTH the existing
  // signal and the new one meaningful, rather than one silently overriding
  // the other.
  const diversityCandidates: DiversityCandidate[] = scored.map((entry) => ({
    index: entry.index,
    score:
      entry.editorialDecision == null
        ? entry.preRankScore
        : (entry.preRankScore + entry.editorialDecision.editorialScore) / 2,
    startTime: input.candidates[entry.index].startTime,
    endTime: input.candidates[entry.index].endTime,
    text: entry.fullText,
    semanticEventTypes: (entry.semanticEvents ?? []).map((event) => event.type),
  }));
  const selected = selectDiverseShortlist(diversityCandidates, targetSize);
  const scoredByIndex = new Map(scored.map((entry) => [entry.index, entry]));

  const shortlisted = selected.map((diversityCandidate) => {
    const entry = scoredByIndex.get(diversityCandidate.index);
    if (!entry) {
      throw new Error(
        `selectDiverseShortlist returned an unknown candidate index: ${diversityCandidate.index}`,
      );
    }
    // Merges in `redundancy` now that the final survivor set is known - a
    // cross-candidate comparison the per-candidate EditorialDecision above
    // couldn't see (selectDiverseShortlist's own greedy redundancy-avoidance
    // already did the real selection work; this is the transparency record
    // of why a backfilled survivor may still read as somewhat redundant).
    const others = selected.filter((other) => other.index !== diversityCandidate.index);
    const redundancy = detectRedundancy(diversityCandidate, [diversityCandidate, ...others]);
    const editorialDecision = entry.editorialDecision
      ? mergeNegativeSignal(entry.editorialDecision, redundancy)
      : null;
    return {
      index: entry.index,
      preRankScore: entry.preRankScore,
      semanticEvents: entry.semanticEvents,
      narrativeGraph: entry.narrativeGraph,
      editorialDecision,
      boundaryNudge: entry.boundaryNudge,
    };
  });

  return shortlistCandidatesOutputSchema.parse({ shortlisted });
}
