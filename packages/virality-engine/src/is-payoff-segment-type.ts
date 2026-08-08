import type { NarrativeSegmentType } from '@speedora/contracts';

function assertNeverNarrativeSegmentType(value: never): never {
  throw new Error(`Unhandled NarrativeSegmentType: ${String(value)}`);
}

// Exhaustive switch over every NARRATIVE_SEGMENT_TYPES value (Contract
// Governance rule 1's assertNever discipline, same pattern as Phase 4's
// momentumMultiplierForSegmentType()/Phase 6's
// emotionalBoostForSemanticEventType()) - adding an 11th type to Phase 3's
// taxonomy later is a compile error until this switch is updated, even
// though this module doesn't introduce that taxonomy itself. A HEURISTIC
// classification (ADR D4), not derived from any real data -
// resolution/takeaway/cta read as "the clip delivers a payoff," everything
// else does not.
export function isPayoffSegmentType(type: NarrativeSegmentType): boolean {
  switch (type) {
    case 'resolution':
    case 'takeaway':
    case 'cta':
      return true;
    case 'hook':
    case 'setup':
    case 'context':
    case 'problem':
    case 'conflict':
    case 'escalation':
    case 'peak':
      return false;
    default:
      return assertNeverNarrativeSegmentType(type);
  }
}
