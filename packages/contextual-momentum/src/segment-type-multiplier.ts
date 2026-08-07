import type { NarrativeSegmentType } from '@speedora/contracts';

function assertNeverNarrativeSegmentType(value: never): never {
  throw new Error(`Unhandled NarrativeSegmentType: ${String(value)}`);
}

// Exhaustive switch over every NARRATIVE_SEGMENT_TYPES value (Contract
// Governance rule 1's assertNever discipline, same pattern as Phases 2-3's
// describeEventType()/describeSegmentType()) - adding an 11th type to
// Phase 3's taxonomy later is a compile error until this switch is
// updated, even though this module doesn't introduce that taxonomy itself.
// A HEURISTIC weighting (ADR D4), not derived from any real data - escalation/
// peak/conflict segments read as "building", resolution/takeaway as
// "releasing", everything else neutral.
export function momentumMultiplierForSegmentType(type: NarrativeSegmentType): number {
  switch (type) {
    case 'escalation':
    case 'peak':
    case 'conflict':
      return 1.2;
    case 'resolution':
    case 'takeaway':
      return 0.85;
    case 'hook':
    case 'setup':
    case 'context':
    case 'problem':
    case 'cta':
      return 1.0;
    default:
      return assertNeverNarrativeSegmentType(type);
  }
}
