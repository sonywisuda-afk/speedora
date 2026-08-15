import type { NegativeSignal } from '@speedora/contracts';
import { PENALTY_CAPS } from './weights';

// Deliberately excludes 1st/2nd-person pronouns (I/you/we/us/my/your) -
// those don't need an in-clip antecedent to read as self-contained. Only
// 3rd-person pronouns can leave a viewer without outside context wondering
// "who/what is 'this'?"
const AMBIGUOUS_PRONOUNS = new Set([
  'this',
  'that',
  'these',
  'those',
  'it',
  'he',
  'she',
  'they',
  'him',
  'her',
  'them',
  'his',
  'hers',
  'their',
  'theirs',
]);

// First ~5-8s of typical speaking rate - matches hook-prediction's own
// HOOK_WINDOW_SECONDS-flavored "does the opening work" framing, applied here
// to context instead of hook strength.
const CONTEXT_WINDOW_WORDS = 15;

// Small, hand-authored (same "collect first, calibrate later" posture as
// every other heuristic constant in this codebase) - common role/occupation
// nouns that plausibly serve as an antecedent ("the manager... he...").
const ROLE_NOUNS = new Set([
  'man',
  'woman',
  'guy',
  'girl',
  'manager',
  'ceo',
  'boss',
  'doctor',
  'expert',
  'host',
  'guest',
  'teacher',
  'customer',
  'client',
  'founder',
  'investor',
  'company',
  'team',
  'player',
  'coach',
]);

const PENALTY_PER_PRONOUN = 8;

function tokenize(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

function stripPunctuation(word: string): string {
  return word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
}

function endsSentence(word: string): boolean {
  return /[.!?]$/.test(word);
}

// A proper-noun-SHAPED token (capitalized, not sentence-initial) or a known
// role noun occurring before `index` in `words` - the best antecedent signal
// available without real named-entity extraction (shortlist mode has none
// yet; this also runs as a fallback in render mode alongside the real
// namedEntities check below).
function hasLexicalAntecedentBefore(words: string[], index: number): boolean {
  for (let i = 0; i < index; i += 1) {
    const raw = stripPunctuation(words[i]);
    if (raw.length === 0) continue;
    if (ROLE_NOUNS.has(raw.toLowerCase())) return true;
    const sentenceInitial = i === 0 || endsSentence(words[i - 1]);
    if (!sentenceInitial && /^[A-Z][a-zA-Z]*$/.test(raw)) return true;
  }
  return false;
}

// namedEntities (HookPredictionOutput.linguisticFeatures.namedEntities) is a
// flat string[] with no position field, so "before the pronoun" is
// approximated as "appears anywhere in the text before this token index" -
// the best available granularity without re-running entity extraction with
// positions.
function hasNamedEntityAntecedentBefore(
  words: string[],
  index: number,
  namedEntities: string[],
): boolean {
  if (namedEntities.length === 0) return false;
  const textBefore = words.slice(0, index).join(' ').toLowerCase();
  return namedEntities.some(
    (entity) => entity.trim().length > 0 && textBefore.includes(entity.trim().toLowerCase()),
  );
}

// Scans the opening CONTEXT_WINDOW_WORDS of the candidate's own transcript
// text for ambiguous 3rd-person pronouns lacking a preceding antecedent.
// Render mode passes real, already-computed named entities
// (hookPrediction.linguisticFeatures.namedEntities); shortlist mode passes
// null (no ML entity extraction has run yet pre-render) and relies on the
// weaker lexical fallback alone - documented here as approximate and
// false-negative-prone in that mode, a real accuracy improvement in render
// mode.
export function detectContextDependency(
  text: string,
  namedEntities: string[] | null,
): NegativeSignal {
  const words = tokenize(text).slice(0, CONTEXT_WINDOW_WORDS);
  if (words.length === 0) {
    return {
      type: 'contextDependency',
      penalty: 0,
      reason: 'No transcript text available to evaluate.',
    };
  }

  const entities = namedEntities ?? [];
  let unresolvedCount = 0;
  words.forEach((word, index) => {
    const normalized = stripPunctuation(word).toLowerCase();
    if (!AMBIGUOUS_PRONOUNS.has(normalized)) return;
    const hasAntecedent =
      hasLexicalAntecedentBefore(words, index) ||
      hasNamedEntityAntecedentBefore(words, index, entities);
    if (!hasAntecedent) unresolvedCount += 1;
  });

  if (unresolvedCount === 0) {
    return {
      type: 'contextDependency',
      penalty: 0,
      reason: 'Opening lines read as self-contained - no unresolved pronoun reference found.',
    };
  }

  const penalty = Math.min(PENALTY_CAPS.contextDependency, unresolvedCount * PENALTY_PER_PRONOUN);
  return {
    type: 'contextDependency',
    penalty,
    reason: `${unresolvedCount} pronoun reference(s) in the opening lines have no clear antecedent within the clip - a viewer without outside context may not know who/what is being discussed.`,
  };
}
