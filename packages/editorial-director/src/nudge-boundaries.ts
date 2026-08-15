import type { BoundaryNudge, NarrativeGraph } from '@speedora/contracts';

const DEFAULT_MAX_EXPANSION_SECONDS = 6;
// A FIXED, coarse nudge amount - not a located sentence boundary. This
// pre-render stage only ever sees the candidate's OWN transcript slice
// (ShortlistCandidateInput.segments is deliberately narrowed to "this
// candidate's own overlapping transcript slice" - see @speedora/contracts'
// candidate-shortlist.ts), so there is no adjacent video text available here
// to find the REAL sentence boundary just outside the candidate's window.
// A user-confirmed scope decision (docs/ai/editorial-director.md): stay
// pre-render/ungrounded for Phase A rather than widen the shortlist input
// contract or defer to a post-render re-cut.
const HEURISTIC_NUDGE_SECONDS = 3;

const SETUP_SEGMENT_TYPES = new Set(['hook', 'setup', 'context']);
const PAYOFF_LIKE_TYPES = new Set(['resolution', 'takeaway', 'cta']);

function looksLikeMidSentenceStart(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const firstWord = trimmed.split(/\s+/)[0].replace(/[^a-zA-Z]/g, '');
  if (firstWord.length === 0) return false;
  const lowercaseConjunctions = new Set(['and', 'but', 'so', 'because', 'which', 'that', 'or']);
  if (lowercaseConjunctions.has(firstWord.toLowerCase())) return true;
  return firstWord[0] !== firstWord[0].toUpperCase();
}

function looksLikeMidSentenceEnd(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return !/[.!?]["')\]]?$/.test(trimmed);
}

// Section 5 (Narrative Boundary Intelligence) of the mission, scoped to
// PRE-RENDER/ungrounded only for Phase A. Applies a small, bounded
// expansion ONLY when two independent signals agree: a LEXICAL one (the
// candidate's own first/last segment text looks like it starts/ends
// mid-sentence) and a STRUCTURAL one (narrativeGraph's own first/last
// segment isn't a setup/context or payoff-like type) - requiring both
// reduces false positives either signal alone would produce. Never SHRINKS
// a candidate, only ever expands or leaves it unchanged (returns null when
// neither signal fires).
export function nudgeCandidateBoundary(
  narrativeGraph: NarrativeGraph | null,
  firstSegmentText: string,
  lastSegmentText: string,
  candidateStartTime: number,
  candidateEndTime: number,
  maxExpansionSeconds: number = DEFAULT_MAX_EXPANSION_SECONDS,
): BoundaryNudge | null {
  const graphSegments =
    narrativeGraph != null && !narrativeGraph.unsegmented ? narrativeGraph.segments : [];
  const sorted = [...graphSegments].sort((a, b) => a.startTime - b.startTime);
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;

  const missingContext =
    looksLikeMidSentenceStart(firstSegmentText) &&
    (first == null || !SETUP_SEGMENT_TYPES.has(first.type));
  const missingPayoff =
    looksLikeMidSentenceEnd(lastSegmentText) && (last == null || !PAYOFF_LIKE_TYPES.has(last.type));

  if (!missingContext && !missingPayoff) return null;

  const desiredStartExpansion = missingContext ? HEURISTIC_NUDGE_SECONDS : 0;
  const desiredEndExpansion = missingPayoff ? HEURISTIC_NUDGE_SECONDS : 0;
  const withinBounds =
    desiredStartExpansion <= maxExpansionSeconds && desiredEndExpansion <= maxExpansionSeconds;

  const reasonParts: string[] = [];
  if (missingContext) {
    reasonParts.push('opening appears to start mid-sentence with no setup/context segment');
  }
  if (missingPayoff) {
    reasonParts.push('closing appears to end mid-sentence with no payoff segment');
  }
  const boundsNote = withinBounds
    ? ''
    : ` (exceeds the ${maxExpansionSeconds}s max expansion - not applied)`;

  return {
    originalStartTime: candidateStartTime,
    originalEndTime: candidateEndTime,
    suggestedStartTime: candidateStartTime - (withinBounds ? desiredStartExpansion : 0),
    suggestedEndTime: candidateEndTime + (withinBounds ? desiredEndExpansion : 0),
    reason: `${reasonParts.join('; ')}${boundsNote} (coarse pre-render heuristic, not a located sentence boundary).`,
    applied: withinBounds,
  };
}
