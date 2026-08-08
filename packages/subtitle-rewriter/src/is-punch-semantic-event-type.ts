import type { SemanticEventType } from '@speedora/contracts';

function assertNeverSemanticEventType(value: never): never {
  throw new Error(`Unhandled SemanticEventType: ${String(value)}`);
}

// Exhaustive switch over every SEMANTIC_EVENT_TYPES value (Contract
// Governance rule 1's assertNever discipline, same pattern as Phase 6's
// emotionalBoostForSemanticEventType()/Phase 7's isPayoffSegmentType()/
// Phase 10's isCuriositySemanticEventType()) - adding a 23rd type to Phase
// 2's taxonomy later is a compile error until this switch is updated, even
// though this module doesn't introduce that taxonomy itself. A HEURISTIC
// classification (ADR D4), on a DIFFERENT axis from
// isCuriositySemanticEventType's "creates an information gap the viewer
// wants closed" - this one asks "does this moment read as high-impact,
// shock, or a turning point," used to boost a subtitle line's
// HighlightTimeline score (spec Part 8's future consumer), not which words
// get selected for bold/uppercase emphasis within a line.
export function isPunchSemanticEventType(type: SemanticEventType): boolean {
  switch (type) {
    case 'breaking_news':
    case 'controversy':
    case 'warning':
    case 'urgency':
    case 'conflict':
    case 'fear':
    case 'achievement':
    case 'transformation':
      return true;
    case 'confession':
    case 'mistake':
    case 'failure':
    case 'success':
    case 'secret':
    case 'prediction':
    case 'tutorial':
    case 'lawsuit':
    case 'money':
    case 'ai':
    case 'business':
    case 'career':
    case 'health':
    case 'life_lesson':
      return false;
    default:
      return assertNeverSemanticEventType(type);
  }
}
