import type { NarrativeSegmentType } from '@speedora/contracts';

function assertNeverNarrativeSegmentType(value: never): never {
  throw new Error(`Unhandled NarrativeSegmentType: ${String(value)}`);
}

// Exhaustive switch over every NARRATIVE_SEGMENT_TYPES value (Contract
// Governance rule 1's assertNever discipline, same pattern as Phase 2's
// describeEventType()) - adding an 11th type to the taxonomy later is a
// compile error until this switch is updated. Used as a fallback `reason`
// when the LLM's own reason string comes back empty.
export function describeSegmentType(type: NarrativeSegmentType): string {
  switch (type) {
    case 'hook':
      return 'The opening moment meant to stop a scrolling viewer.';
    case 'setup':
      return 'Establishes who/what this clip is about.';
    case 'context':
      return 'Background information the viewer needs to follow along.';
    case 'problem':
      return 'States the central issue or challenge.';
    case 'conflict':
      return 'A clash, obstacle, or tension within the problem.';
    case 'escalation':
      return 'The stakes or tension increase.';
    case 'peak':
      return 'The moment of highest tension or significance.';
    case 'resolution':
      return 'The conflict or problem is resolved.';
    case 'takeaway':
      return 'The lesson or conclusion the viewer should leave with.';
    case 'cta':
      return 'A direct call to action to the viewer.';
    default:
      return assertNeverNarrativeSegmentType(type);
  }
}
