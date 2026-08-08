import type { MultimodalRelationType } from '@speedora/contracts';

function assertNeverMultimodalRelationType(value: never): never {
  throw new Error(`Unhandled MultimodalRelationType: ${String(value)}`);
}

// Exhaustive switch over every MULTIMODAL_RELATION_TYPES value (Contract Governance rule 1's
// assertNever discipline, same pattern as @speedora/semantic-events' describeEventType/
// @speedora/narrative-graph's describeSegmentType) - adding a 4th relation type later is a compile
// error until this switch is updated. Used as a fallback `reason` when the LLM's own reason string
// comes back empty.
export function describeRelationType(type: MultimodalRelationType): string {
  switch (type) {
    case 'refers_to':
      return 'One evidence item verbally references what another evidence item shows.';
    case 'co_occurs_with':
      return 'These evidence items overlap in time across different modalities.';
    case 'emphasizes':
      return 'One evidence item intensifies or underscores the moment another evidence item establishes.';
    default:
      return assertNeverMultimodalRelationType(type);
  }
}
