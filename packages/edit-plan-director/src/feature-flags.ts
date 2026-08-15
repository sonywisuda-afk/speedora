// Edit Plan Director Phase B (docs/ai/edit-plan-director.md). Follows isEditorialDirectorEnabled()'s
// exact shape (ADR D8): boolean env vars, read lazily (function body, not a module-level const) so
// they aren't captured before dotenv's config() call runs elsewhere in the process.
//
// Two SEPARATE, composable flags per the mission's own Section 21 flag list - Edit Budget and the
// Effect Conflict Resolver can be enabled independently. Both gate REAL BEHAVIOR (unlike Phase A's
// render-mode flag, which only gates API exposure) - render-clip.worker.ts's own EditPlanResult.
// suggestions is the identical input array, unchanged, whenever both are off (the default).
export function isEditBudgetEnabled(): boolean {
  return process.env.EDIT_BUDGET_ENABLED === 'true';
}

export function isEffectConflictResolutionEnabled(): boolean {
  return process.env.EFFECT_CONFLICT_RESOLUTION_ENABLED === 'true';
}
