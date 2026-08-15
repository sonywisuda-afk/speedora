import type { NegativeSignal } from '@speedora/contracts';
import {
  PENALTY_CAPS,
  REDUNDANCY_THRESHOLD,
  SEMANTIC_EVENT_SIMILARITY_WEIGHT,
  TEXT_SIMILARITY_WEIGHT,
} from './weights';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Small, hand-authored stopword list - just enough to keep the Jaccard
// comparison from being dominated by function words, same "collect first,
// calibrate later" posture as every other heuristic constant here.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'and',
  'or',
  'but',
  'with',
  'as',
  'that',
  'this',
  'it',
  'i',
  'you',
  'he',
  'she',
  'they',
  'we',
  'my',
  'your',
  'his',
  'her',
  'their',
  'our',
  'so',
  'if',
  'not',
  'no',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'will',
  'would',
  'can',
  'could',
  'just',
  'like',
  'about',
]);

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word));
}

// Unigrams + bigrams in one set - bigrams catch "lost money"/"money lost"
// style near-duplicates a pure unigram bag-of-words would miss.
function buildNgramSet(words: string[]): Set<string> {
  const set = new Set<string>();
  words.forEach((word) => set.add(word));
  for (let i = 0; i < words.length - 1; i += 1) {
    set.add(`${words[i]}_${words[i + 1]}`);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// The generic shape @speedora/candidate-shortlist's own scored candidates
// get mapped into for this module's diversity/redundancy functions -
// deliberately package-agnostic (index/score/time window/text/event types
// only) so this package never needs to depend on candidate-shortlist's own
// internal types (which depend on this package - the dependency runs one
// way).
export interface DiversityCandidate {
  index: number;
  score: number;
  startTime: number;
  endTime: number;
  text: string;
  semanticEventTypes: string[];
}

function timeRangesOverlap(a: DiversityCandidate, b: DiversityCandidate): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

// Section 8 (Candidate Diversity) of the mission - heuristic text/topic
// overlap (keyword Jaccard + semantic-event-type overlap), a user-confirmed
// scope decision for Phase A (no real embeddings this phase, see
// docs/ai/editorial-director.md).
export function computeCandidateSimilarity(a: DiversityCandidate, b: DiversityCandidate): number {
  const textSimilarity = jaccard(
    buildNgramSet(normalizeWords(a.text)),
    buildNgramSet(normalizeWords(b.text)),
  );
  const eventSimilarity = jaccard(new Set(a.semanticEventTypes), new Set(b.semanticEventTypes));
  return (
    TEXT_SIMILARITY_WEIGHT * textSimilarity + SEMANTIC_EVENT_SIMILARITY_WEIGHT * eventSimilarity
  );
}

// redundancy (shortlist mode only - a cross-candidate comparison; render
// mode never re-runs diversity selection across already-fixed, already-
// rendered siblings, see this module's own contract doc comment).
export function detectRedundancy(
  candidate: DiversityCandidate,
  others: DiversityCandidate[],
): NegativeSignal {
  let maxSimilarity = 0;
  for (const other of others) {
    if (other.index === candidate.index) continue;
    if (timeRangesOverlap(candidate, other)) continue;
    maxSimilarity = Math.max(maxSimilarity, computeCandidateSimilarity(candidate, other));
  }
  if (maxSimilarity < REDUNDANCY_THRESHOLD) {
    return { type: 'redundancy', penalty: 0, reason: 'No near-duplicate candidate detected.' };
  }
  const severity = clamp((maxSimilarity - REDUNDANCY_THRESHOLD) / (1 - REDUNDANCY_THRESHOLD), 0, 1);
  const penalty = severity * PENALTY_CAPS.redundancy;
  return {
    type: 'redundancy',
    penalty,
    reason: `Topically similar to another candidate at a different timestamp (similarity ${(maxSimilarity * 100).toFixed(0)}%).`,
  };
}

// Prefers a lower-scored-but-DISTINCT candidate over a redundant
// higher-scored one (mission Section 8's own worked example: "if candidate
// #7 is slightly lower but represents a different topic and the top
// candidates are already redundant, #7 should be selectable"). Primarily
// sorts by `score` (package-agnostic - the caller decides what this means;
// @speedora/candidate-shortlist passes each candidate's OWN
// EditorialDecision.editorialScore, so negative-signal penalties already
// factor into ordering here, not just redundancy), then walks down that
// order skipping any candidate redundant with an already-selected one.
// Never returns fewer than min(targetSize, candidates.length) - the same
// size guarantee the plain top-N sort it replaces already gave callers - by
// backfilling from the skipped candidates (by score) if strict redundancy
// filtering alone would leave the shortlist under target.
export function selectDiverseShortlist(
  candidates: DiversityCandidate[],
  targetSize: number,
): DiversityCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const selected: DiversityCandidate[] = [];

  for (const candidate of sorted) {
    if (selected.length >= targetSize) break;
    const isRedundant = selected.some(
      (chosen) =>
        !timeRangesOverlap(candidate, chosen) &&
        computeCandidateSimilarity(candidate, chosen) >= REDUNDANCY_THRESHOLD,
    );
    if (!isRedundant) selected.push(candidate);
  }

  if (selected.length < Math.min(targetSize, sorted.length)) {
    const selectedIndices = new Set(selected.map((candidate) => candidate.index));
    for (const candidate of sorted) {
      if (selected.length >= targetSize) break;
      if (!selectedIndices.has(candidate.index)) selected.push(candidate);
    }
  }

  return selected;
}
