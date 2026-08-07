import type { SemanticEventType } from '@speedora/contracts';

function assertNeverSemanticEventType(value: never): never {
  throw new Error(`Unhandled SemanticEventType: ${String(value)}`);
}

// Exhaustive switch over every SEMANTIC_EVENT_TYPES value (Contract
// Governance rule 1's assertNever discipline, same pattern as Phase 4's
// momentumMultiplierForSegmentType()) - adding a 23rd type to Phase 2's
// taxonomy later is a compile error until this switch is updated, even
// though this module doesn't introduce that taxonomy itself. A HEURISTIC
// tiering (ADR D4), not derived from any real data - high-charge types
// (confession/secret/failure/conflict/fear/controversy/transformation) get
// the biggest boost, medium-charge types a smaller one, purely
// informational types none at all.
export function emotionalBoostForSemanticEventType(type: SemanticEventType): number {
  switch (type) {
    case 'confession':
    case 'secret':
    case 'failure':
    case 'conflict':
    case 'fear':
    case 'controversy':
    case 'transformation':
      return 0.2;
    case 'mistake':
    case 'success':
    case 'warning':
    case 'breaking_news':
    case 'lawsuit':
    case 'health':
    case 'urgency':
    case 'achievement':
    case 'life_lesson':
      return 0.1;
    case 'prediction':
    case 'tutorial':
    case 'money':
    case 'ai':
    case 'business':
    case 'career':
      return 0;
    default:
      return assertNeverSemanticEventType(type);
  }
}
