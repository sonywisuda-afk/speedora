import type {
  ConflictDecision,
  EditBudget,
  EditingSuggestion,
  EditingTechnique,
} from '@speedora/contracts';

const BUDGET_FIELD_BY_TECHNIQUE: Partial<Record<EditingTechnique, keyof EditBudget>> = {
  focus_shift: 'maxFocusShifts',
  speaker_focus_shift: 'maxSpeakerFocusShifts',
  digital_push: 'maxDigitalPush',
  ocr_highlight: 'maxOcrHighlights',
  reaction_hold: 'maxReactionHolds',
};

export interface EnforceBudgetResult {
  suggestions: EditingSuggestion[];
  decisions: ConflictDecision[];
}

// Budget enforcement (mission Section 12) - after conflict resolution, if a technique's surviving
// count still exceeds its EditBudget cap, drops the LOWEST-score suggestions of that technique
// first, finally giving EditingSuggestion.score real teeth beyond pure relative-ranking display -
// see @speedora/contracts' visual-emphasis.ts's own doc comment on `score`, which had no consumer
// until this function. pause_hold/attention_cut have no budget field (see BUDGETED_TECHNIQUES' own
// doc comment in edit-plan-director.ts) and pass through untouched.
export function enforceBudget(
  suggestions: EditingSuggestion[],
  budget: EditBudget,
): EnforceBudgetResult {
  const decisions: ConflictDecision[] = [];
  const kept: EditingSuggestion[] = [];

  const budgetedTechniques = Object.keys(
    BUDGET_FIELD_BY_TECHNIQUE,
  ) as (keyof typeof BUDGET_FIELD_BY_TECHNIQUE)[];

  for (const technique of budgetedTechniques) {
    const field = BUDGET_FIELD_BY_TECHNIQUE[technique];
    if (!field) continue;
    const cap = budget[field];
    const ofThisTechnique = suggestions
      .filter((suggestion) => suggestion.technique === technique)
      .sort((a, b) => b.score - a.score); // highest score first - survives the cut first.
    const survivors = ofThisTechnique.slice(0, cap);
    const dropped = ofThisTechnique.slice(cap);
    kept.push(...survivors);
    for (const suggestion of dropped) {
      decisions.push({
        action: 'suppressed',
        reasonCode: 'over_budget',
        technique: suggestion.technique,
        start: suggestion.start,
        end: suggestion.end,
        relatedTechnique: null,
        reason:
          `This clip's edit budget allows at most ${cap} ${technique} suggestion(s); this one ` +
          `had the lowest score (${suggestion.score.toFixed(2)}) among ${ofThisTechnique.length} ` +
          `candidates and was dropped.`,
      });
    }
  }

  // Techniques with no budget field (pause_hold, attention_cut) pass through untouched.
  const unbudgeted = suggestions.filter(
    (suggestion) => !(suggestion.technique in BUDGET_FIELD_BY_TECHNIQUE),
  );
  kept.push(...unbudgeted);

  // Restore original relative ordering (sorted by start) - budget enforcement only removes
  // entries, it shouldn't reorder the timeline.
  kept.sort((a, b) => a.start - b.start);

  return { suggestions: kept, decisions };
}
