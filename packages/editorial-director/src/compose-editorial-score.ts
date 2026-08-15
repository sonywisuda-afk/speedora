import type {
  ClipScores,
  EditorialCategory,
  EditorialCategoryScores,
  EditorialMode,
  NarrativeGraph,
  NegativeSignal,
} from '@speedora/contracts';
import { EDITORIAL_CATEGORIES } from '@speedora/contracts';
import { computePlatformFit } from '@speedora/platform-fit';
import { deriveNarrativeGraphScore } from '@speedora/virality-engine';
import { deriveContextCompletenessScore } from './derive-context-completeness';
import { MAX_TOTAL_PENALTY } from './weights';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface DeriveEditorialCategoriesInput {
  mode: EditorialMode;
  scores: ClipScores;
  narrativeGraph: NarrativeGraph | null;
  // render mode only - all optional/undefined in shortlist mode, where none
  // of this grounded data exists yet.
  hookProbability?: number | null;
  // 0-1, EmotionalArc's own peak intensity within this clip.
  emotionalArcPeakIntensity?: number | null;
  // 0-1 each - editingSuggestions[].score for whichever suggestions apply
  // to this clip (empty array is a real "nothing suggested" result, not
  // missing data - see EditingSuggestionTimeline's own doc comment).
  editingSuggestionScores?: number[];
  // 0-100, null when speakerCount <= 1 (not a low score - conversational
  // clarity simply isn't a meaningful axis for a solo clip, same
  // non-penalization convention @speedora/clip-ranking's own
  // conversationEngagementScore already established for monologues).
  speakerClarityScore?: number | null;
}

// Category composition - the structural fix for clip-ranking's own
// documented double-counting bug (see weights.ts's own module comment and
// docs/ai/clip-ranking-engine.md). Each category draws from a DOCUMENTED,
// mostly-non-overlapping set of source signals rather than a naive average
// over every raw sub-score.
export function deriveEditorialCategories(
  input: DeriveEditorialCategoriesInput,
): EditorialCategoryScores {
  const scores = input.scores;
  const clamped = {
    hookStrength: clamp(scores.hookStrength, 0, 100),
    educationalValue: clamp(scores.educationalValue, 0, 100),
    practicalValue: clamp(scores.practicalValue, 0, 100),
    novelty: clamp(scores.novelty, 0, 100),
    trustAuthority: clamp(scores.trustAuthority, 0, 100),
    curiosity: clamp(scores.curiosity, 0, 100),
    emotion: clamp(scores.emotion, 0, 100),
  };

  // contentValue: the "Knowledge" domain of ClipScores (SCORE_DOMAINS,
  // packages/contracts/src/clip-scoring.ts) - educational/practical/novel/
  // trustworthy. Deliberately excludes hookStrength/curiosity/emotion
  // (the "Engagement" domain, used by hookStrength/emotionalPayoff below
  // instead) to keep the two domains from bleeding into each other.
  const contentValue = average([
    clamped.educationalValue,
    clamped.practicalValue,
    clamped.novelty,
    clamped.trustAuthority,
  ]);

  // hookStrength: ClipScores' own "Engagement" domain fields
  // (hookStrength/curiosity), plus - render mode only - the real, grounded
  // hookPrediction.hookProbability (a DIFFERENT question than clip-scoring's
  // hookStrength, see docs/ai/scoring.md - averaging both gives a fuller
  // picture without discarding either).
  const hookStrength =
    input.mode === 'render' && input.hookProbability != null
      ? average([input.hookProbability, clamped.hookStrength, clamped.curiosity])
      : average([clamped.hookStrength, clamped.curiosity]);

  const narrativeCompleteness = deriveNarrativeGraphScore(input.narrativeGraph);
  const contextCompleteness = deriveContextCompletenessScore(input.narrativeGraph);

  // emotionalPayoff: ClipScores' own `emotion` field, plus - render mode
  // only - EmotionalArc's real peak intensity.
  const emotionalPayoff =
    input.mode === 'render' && input.emotionalArcPeakIntensity != null
      ? average([input.emotionalArcPeakIntensity * 100, clamped.emotion])
      : clamped.emotion;

  // visualEngagement: render mode only - average editingSuggestions[].score
  // for this clip. A neutral baseline (50), not a penalty, when render mode
  // has zero suggestions (a real "nothing suggested" result carries no
  // engagement signal either way, same "don't fabricate a penalty from an
  // absence" convention every negative-signal detector in this package
  // already follows).
  const visualEngagement =
    input.mode !== 'render'
      ? null
      : input.editingSuggestionScores && input.editingSuggestionScores.length > 0
        ? average(input.editingSuggestionScores) * 100
        : 50;

  const speakerClarity = input.mode === 'render' ? (input.speakerClarityScore ?? null) : null;

  // platformFit: reuses @speedora/platform-fit's own computePlatformFit()
  // unchanged - the BEST-fit platform's score, both modes (ClipScores is
  // already available pre-render).
  const platformFit = computePlatformFit(scores).rankings[0]?.score ?? 50;

  return {
    contentValue: clamp(contentValue, 0, 100),
    hookStrength: clamp(hookStrength, 0, 100),
    narrativeCompleteness: clamp(narrativeCompleteness, 0, 100),
    contextCompleteness: clamp(contextCompleteness, 0, 100),
    emotionalPayoff: clamp(emotionalPayoff, 0, 100),
    visualEngagement: visualEngagement === null ? null : clamp(visualEngagement, 0, 100),
    speakerClarity: speakerClarity === null ? null : clamp(speakerClarity, 0, 100),
    platformFit: clamp(platformFit, 0, 100),
  };
}

// Weighted composite over `categories`, re-normalized over whichever
// categories are non-null (same "average of non-null" convention
// @speedora/clip-ranking's own compositeScore already uses), minus the
// capped sum of negativeSignals[].penalty, clamped to [0, 100].
export function composeEditorialScore(
  categories: EditorialCategoryScores,
  negativeSignals: NegativeSignal[],
  weights: Record<EditorialCategory, number>,
): number {
  const entries = (Object.entries(categories) as [EditorialCategory, number | null][]).filter(
    (entry): entry is [EditorialCategory, number] => entry[1] !== null,
  );
  if (entries.length === 0) return 0;

  const totalWeight = entries.reduce((sum, [category]) => sum + (weights[category] ?? 0), 0);
  const baseScore =
    totalWeight === 0
      ? average(entries.map(([, value]) => value))
      : entries.reduce((sum, [category, value]) => sum + (weights[category] ?? 0) * value, 0) /
        totalWeight;

  const totalPenalty = Math.min(
    MAX_TOTAL_PENALTY,
    negativeSignals.reduce((sum, signal) => sum + signal.penalty, 0),
  );

  return clamp(baseScore - totalPenalty, 0, 100);
}

// CODE-COMPUTED coverage: count(non-null categories) / EDITORIAL_CATEGORIES.
// length - same "kind of confidence" as ClipRank.confidence/
// ViralityPrediction.confidence, not an LLM self-report.
export function computeCategoryConfidence(categories: EditorialCategoryScores): number {
  const nonNullCount = EDITORIAL_CATEGORIES.filter(
    (category) => categories[category] !== null,
  ).length;
  return nonNullCount / EDITORIAL_CATEGORIES.length;
}
