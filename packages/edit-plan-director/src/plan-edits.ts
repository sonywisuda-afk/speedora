import {
  editPlanResultSchema,
  type ConflictDecision,
  type EditPlanResult,
  type PlanEditsInput,
} from '@speedora/contracts';
import { computeEditBudget } from './compute-edit-budget';
import { enforceBudget } from './enforce-budget';
import { isEditBudgetEnabled, isEffectConflictResolutionEnabled } from './feature-flags';
import { resolveConflicts } from './resolve-conflicts';

// The module's single entry point (ARCHITECTURE.md's JSON-contract module checklist) - pure and
// synchronous, no `deps` parameter, no LLM call. `budget` is ALWAYS computed (cheap, pure - same
// ADR D8 "compute always" posture Phase A's render-mode EditorialDecision already established) so
// it's meaningful for observability even when EDIT_BUDGET_ENABLED is off; `suggestions` is the
// identical input array, unchanged, whenever BOTH flags are off (the default) - same "byte-for-byte
// unchanged when the flag is off" discipline as every other phase in this roadmap.
export function planEdits(input: PlanEditsInput): EditPlanResult {
  const budget = computeEditBudget({
    clipDurationSeconds: input.clipDurationSeconds,
    speakerCount: input.speakerCount,
    hasVisualInstabilityOrOverEditingRisk: input.hasVisualInstabilityOrOverEditingRisk,
  });

  let suggestions = input.suggestions;
  const decisions: ConflictDecision[] = [];

  // Conflict resolution runs BEFORE budget enforcement - a suggestion the resolver already
  // suppressed (e.g. an overlapping digital_push) should never also compete for budget headroom,
  // and a suggestion the resolver keeps should be judged against the budget on its own merits.
  if (isEffectConflictResolutionEnabled()) {
    const result = resolveConflicts(suggestions);
    suggestions = result.suggestions;
    decisions.push(...result.decisions);
  }

  if (isEditBudgetEnabled()) {
    const result = enforceBudget(suggestions, budget);
    suggestions = result.suggestions;
    decisions.push(...result.decisions);
  }

  return editPlanResultSchema.parse({ suggestions, budget, decisions });
}
