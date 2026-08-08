import type { SemanticEventType } from '@speedora/contracts';

function assertNeverSemanticEventType(value: never): never {
  throw new Error(`Unhandled SemanticEventType: ${String(value)}`);
}

// Exhaustive switch over every SEMANTIC_EVENT_TYPES value (Contract
// Governance rule 1's assertNever discipline, same pattern as Phase 6's
// emotionalBoostForSemanticEventType()/Phase 7's isPayoffSegmentType()) -
// adding a 23rd type to Phase 2's taxonomy later is a compile error until
// this switch is updated, even though this module doesn't introduce that
// taxonomy itself. A HEURISTIC classification (ADR D4), not derived from
// any real data - secret/prediction/warning/breaking_news/controversy all
// read as "creates an information gap the viewer wants closed" (an
// unresolved question, an implied future, a withheld fact, novelty,
// visible disagreement); every other type does not.
export function isCuriositySemanticEventType(type: SemanticEventType): boolean {
  switch (type) {
    case 'secret':
    case 'prediction':
    case 'warning':
    case 'breaking_news':
    case 'controversy':
      return true;
    case 'confession':
    case 'mistake':
    case 'failure':
    case 'success':
    case 'tutorial':
    case 'conflict':
    case 'lawsuit':
    case 'money':
    case 'ai':
    case 'business':
    case 'career':
    case 'health':
    case 'fear':
    case 'urgency':
    case 'achievement':
    case 'transformation':
    case 'life_lesson':
      return false;
    default:
      return assertNeverSemanticEventType(type);
  }
}
