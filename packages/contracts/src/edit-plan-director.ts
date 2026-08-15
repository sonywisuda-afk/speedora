import { z } from 'zod';
import { editingSuggestionTimelineSchema, editingTechniqueSchema } from './visual-emphasis';

// Phase B ("Edit Orchestration" - see docs/ai/edit-plan-director.md) of the mission's own 30-
// section "Speedora Editorial Operating System" roadmap, building on Phase A's Editorial Director.
// Governs the render pipeline's own EditingSuggestion[] timeline (Visual Emphasis Engine's 9
// techniques) with an adaptive per-technique budget and a small set of conflict-resolution rules
// grounded in the real, already-quantified evidence from docs/ai/visual-emphasis-integration-audit.md's
// Gate B (531px/s peak combined crop velocity and a 160px/0.4s displacement for Focus Shift x
// Digital Push at their worst-case overlap; OCR Highlight's static-snapshot drift measured across
// movement magnitudes; Reaction Hold x Pause Hold confirmed as an intentional, correct-by-design
// product dependency, not a bug).
//
// Every numeric field here is a documented HEURISTIC (ADR D4, docs/coding-standards.md's "scale
// honesty") - Gate B's own real render measurements inform these starting values, but that audit
// explicitly declined to pick a specific arbitration rule pending real-footage calibration (Gate
// C). This phase builds the MECHANISM using Gate B's evidence as an informed starting point, not a
// claim that these exact numbers are the calibrated answer - see this module's own doc for the full
// reasoning.

// The 4 techniques this phase actually governs (out of EDITING_TECHNIQUES' full 7) - pause_hold is
// deliberately excluded from budget caps (protecting a pause isn't ADDING a visible effect, same
// methodological distinction Gate B's own B5 measurements already used), and attention_cut has no
// render consumer wired anywhere yet (confirmed by audit) - applying budget/conflict logic to a
// technique nothing renders would be dead code exercising dead code.
export const BUDGETED_TECHNIQUES = [
  'focus_shift',
  'speaker_focus_shift',
  'digital_push',
  'ocr_highlight',
  'reaction_hold',
] as const;
export type BudgetedTechnique = (typeof BUDGETED_TECHNIQUES)[number];

// Adaptive per-technique caps for one clip - see compute-edit-budget.ts for the actual scaling
// formula (duration/visualInstability-overEditingRisk/speakerCount inputs).
export const editBudgetSchema = z.object({
  maxFocusShifts: z.number().int().nonnegative(),
  maxSpeakerFocusShifts: z.number().int().nonnegative(),
  maxDigitalPush: z.number().int().nonnegative(),
  maxOcrHighlights: z.number().int().nonnegative(),
  maxReactionHolds: z.number().int().nonnegative(),
});
export type EditBudget = z.infer<typeof editBudgetSchema>;

// Which real-world rule produced this decision - each maps to one specific, named finding from
// Gate B (or the budget-enforcement pass itself), not a generic "conflict #4" label. Mirrors the
// mission's own KEEP A/KEEP B/KEEP BOTH/MERGE/REDUCE INTENSITY/MOVE TIMING/DROP BOTH taxonomy at
// the CONCEPT level, but only names the specific actions this phase actually implements - see
// resolve-conflicts.ts's own module comment for why continuous "reduce intensity" (true magnitude
// damping) isn't one of them yet.
export const CONFLICT_DECISION_REASON_CODES = [
  // REDUCE INTENSITY, implemented as suppression - Gate B's B1 finding (531px/s / 160px-per-0.4s
  // worst case).
  'focus_shift_digital_push_overlap',
  // DROP - Gate B's B2 finding (OCR Highlight's static box becomes misleading, not just imprecise,
  // during large crop movement).
  'ocr_highlight_crop_movement_overlap',
  // KEEP BOTH, observability only - Gate B's B3 finding (already correct-by-design via
  // remapTimestamp(), no code change).
  'reaction_hold_pause_hold_product_dependency',
  // DROP - this technique's surviving count still exceeded its EditBudget cap after conflict
  // resolution; the lowest-`score` suggestion(s) were dropped first.
  'over_budget',
] as const;
export const conflictDecisionReasonCodeSchema = z.enum(CONFLICT_DECISION_REASON_CODES);
export type ConflictDecisionReasonCode = z.infer<typeof conflictDecisionReasonCodeSchema>;

export const conflictDecisionSchema = z.object({
  action: z.enum(['suppressed', 'kept']),
  reasonCode: conflictDecisionReasonCodeSchema,
  technique: editingTechniqueSchema,
  // Clip-relative seconds - the specific suggestion this decision is about.
  start: z.number(),
  end: z.number(),
  // The other technique involved, when this decision came from a pairwise rule - null for a
  // budget-enforcement drop (no second technique involved) or a decision with no counterpart.
  relatedTechnique: editingTechniqueSchema.nullable(),
  // Human-readable explanation, same "written for a human, not a log message" convention as
  // clip-scoring's own `reason` field / Editorial Director's own NegativeSignal.reason.
  reason: z.string(),
});
export type ConflictDecision = z.infer<typeof conflictDecisionSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is already-computed elsewhere;
// this module derives nothing raw of its own. `hasVisualInstabilityOrOverEditingRisk` is a plain
// boolean the caller derives from Phase A's own EditorialDecision.negativeSignals - this package has
// no dependency on @speedora/editorial-director (a boolean flag, not a cross-package coupling, same
// "package boundary via primitive value, not shared type" precedent this codebase already uses
// elsewhere).
export const planEditsInputSchema = z.object({
  suggestions: editingSuggestionTimelineSchema,
  clipDurationSeconds: z.number().nonnegative(),
  speakerCount: z.number().int().nonnegative(),
  hasVisualInstabilityOrOverEditingRisk: z.boolean(),
});
export type PlanEditsInput = z.infer<typeof planEditsInputSchema>;

export const editPlanResultSchema = z.object({
  // The arbitrated timeline - identical to the input `suggestions` array when both
  // EDIT_BUDGET_ENABLED and EFFECT_CONFLICT_RESOLUTION_ENABLED are off (default), same "byte-for-
  // byte unchanged when the flag is off" discipline as Phase A.
  suggestions: editingSuggestionTimelineSchema,
  budget: editBudgetSchema,
  decisions: z.array(conflictDecisionSchema),
});
export type EditPlanResult = z.infer<typeof editPlanResultSchema>;
