import type { ConflictDecision, EditingSuggestion } from '@speedora/contracts';

function overlaps(a: EditingSuggestion, b: EditingSuggestion): boolean {
  return a.start < b.end && b.start < a.end;
}

// focus_shift and speaker_focus_shift are two independent trigger sources (Speaker Intelligence
// Phase E vs. the original Visual Emphasis Phase C3) but both resolve into the SAME downstream
// crop-pan mechanism inside buildReframePlan()/buildCropPath() - treated as one "shift" family here
// for conflict-checking purposes, matching that shared downstream behavior.
const SHIFT_TECHNIQUES = new Set(['focus_shift', 'speaker_focus_shift']);

export interface ResolveConflictsResult {
  suggestions: EditingSuggestion[];
  decisions: ConflictDecision[];
}

// Effect Conflict Resolver (mission Section 13) - implements the specific pairwise rules grounded
// in docs/ai/visual-emphasis-integration-audit.md's real Gate B evidence (see this package's own
// contract doc comment, edit-plan-director.ts, for the full finding-to-rule mapping). Time overlap
// is used as the trigger condition throughout, not a computed velocity/displacement estimate - this
// function only ever sees the abstract EditingSuggestion timeline (start/end/score/reason), never
// the actual crop-path pixel positions Gate B's own measurements were taken from. Documented as a
// real, named limitation (see docs/ai/edit-plan-director.md), not hidden.
export function resolveConflicts(suggestions: EditingSuggestion[]): ResolveConflictsResult {
  const decisions: ConflictDecision[] = [];

  // Rule 1 (Gate B1, the one HIGH/unmitigated finding): Focus Shift/Speaker Focus Shift x Digital
  // Push overlap -> suppress the digital_push trigger, keep the shift. "REDUCE INTENSITY" per the
  // mission's own taxonomy, implemented as suppression rather than continuous magnitude damping -
  // buildCropPath() has no per-trigger intensity channel today, only one global zoomInFraction; see
  // this package's own package.json description for the full tradeoff.
  const shiftSuggestions = suggestions.filter((s) => SHIFT_TECHNIQUES.has(s.technique));
  const afterRule1 = suggestions.filter((suggestion) => {
    if (suggestion.technique !== 'digital_push') return true;
    const conflictingShift = shiftSuggestions.find((shift) => overlaps(suggestion, shift));
    if (!conflictingShift) return true;
    decisions.push({
      action: 'suppressed',
      reasonCode: 'focus_shift_digital_push_overlap',
      technique: suggestion.technique,
      start: suggestion.start,
      end: suggestion.end,
      relatedTechnique: conflictingShift.technique,
      reason:
        `Overlaps a ${conflictingShift.technique} window ` +
        `[${conflictingShift.start.toFixed(1)}-${conflictingShift.end.toFixed(1)}] - combined ` +
        `pan+zoom at this magnitude measured up to 531px/s in Gate B's own real-render evidence, ` +
        `so the discretionary zoom is suppressed and the subject-change snap is kept.`,
    });
    return false;
  });

  // Rule 2 (Gate B2, coupled to B1): OCR Highlight x a SURVIVING (post-Rule-1) shift/digital_push
  // suggestion overlap -> suppress the highlight box. A static snapshot pointing at the wrong
  // region reads worse than no highlight at all, per Gate B2's own "Large/Extreme" measurements
  // (drift up to ~40% of output width, or the tracked box leaving the frame entirely).
  const movingCropSuggestions = afterRule1.filter(
    (s) => SHIFT_TECHNIQUES.has(s.technique) || s.technique === 'digital_push',
  );
  const afterRule2 = afterRule1.filter((suggestion) => {
    if (suggestion.technique !== 'ocr_highlight') return true;
    const conflictingMove = movingCropSuggestions.find((move) => overlaps(suggestion, move));
    if (!conflictingMove) return true;
    decisions.push({
      action: 'suppressed',
      reasonCode: 'ocr_highlight_crop_movement_overlap',
      technique: suggestion.technique,
      start: suggestion.start,
      end: suggestion.end,
      relatedTechnique: conflictingMove.technique,
      reason:
        `Overlaps a ${conflictingMove.technique} window ` +
        `[${conflictingMove.start.toFixed(1)}-${conflictingMove.end.toFixed(1)}] - Gate B's own ` +
        `measurements found the static highlight box can drift up to ~40% of the output width, or ` +
        `leave the frame entirely, during crop movement at this magnitude.`,
    });
    return false;
  });

  // Rule 3 (Gate B3, observability only - NO suggestion is ever dropped by this rule): Reaction
  // Hold overlapping a Pause Hold's own protected window is a confirmed, intentional PRODUCT
  // DEPENDENCY (remapTimestamp()'s own null-for-cut-away-instant semantics already handle this
  // correctly downstream) - only recorded, satisfying the mission's own "why effect applied"
  // observability ask (Section 20) without touching already-verified rendering code.
  const pauseHolds = afterRule2.filter((s) => s.technique === 'pause_hold');
  for (const reactionHold of afterRule2.filter((s) => s.technique === 'reaction_hold')) {
    const relatedPause = pauseHolds.find((pause) => overlaps(reactionHold, pause));
    if (!relatedPause) continue;
    decisions.push({
      action: 'kept',
      reasonCode: 'reaction_hold_pause_hold_product_dependency',
      technique: reactionHold.technique,
      start: reactionHold.start,
      end: reactionHold.end,
      relatedTechnique: relatedPause.technique,
      reason:
        `Overlaps a pause_hold window [${relatedPause.start.toFixed(1)}-${relatedPause.end.toFixed(1)}] ` +
        `- confirmed intentional (docs/ai/visual-emphasis-integration-audit.md's Gate B3): whether ` +
        `this hold survives downstream depends on whether Pause Hold actually protects that silence ` +
        `gap, a real product dependency, not a bug.`,
    });
  }

  return { suggestions: afterRule2, decisions };
}
