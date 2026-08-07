import type { SemanticEventType } from '@speedora/contracts';

function assertNeverSemanticEventType(value: never): never {
  throw new Error(`Unhandled SemanticEventType: ${String(value)}`);
}

// Exhaustive switch over every SEMANTIC_EVENT_TYPES value (Contract
// Governance rule 1's assertNever discipline, same pattern as
// dashboard.service.ts's mapActivityEventType) - adding a 23rd type to the
// taxonomy later is a compile error until this switch is updated. Used as
// a fallback `reason` when the LLM's own reason string comes back empty,
// and as this module's own concrete "enum governance from day 1" guard
// (docs/ai/intelligence-v4.md's Phase 2 risk note).
export function describeEventType(type: SemanticEventType): string {
  switch (type) {
    case 'confession':
      return 'The speaker admits something personal or previously undisclosed.';
    case 'mistake':
      return 'The speaker describes an error they made.';
    case 'failure':
      return 'The speaker describes an attempt that did not succeed.';
    case 'success':
      return 'The speaker describes an attempt that succeeded.';
    case 'secret':
      return 'The speaker reveals information not commonly known.';
    case 'warning':
      return 'The speaker cautions the viewer against something.';
    case 'prediction':
      return 'The speaker forecasts a future outcome.';
    case 'tutorial':
      return 'The speaker explains how to do something, step by step.';
    case 'breaking_news':
      return 'The speaker reports a recent, notable event.';
    case 'conflict':
      return 'The speaker describes a disagreement or clash.';
    case 'lawsuit':
      return 'The speaker discusses legal action.';
    case 'money':
      return 'The speaker discusses a specific financial amount or outcome.';
    case 'ai':
      return 'The speaker discusses artificial intelligence.';
    case 'business':
      return 'The speaker discusses a business topic.';
    case 'career':
      return "The speaker discusses their or someone's career.";
    case 'health':
      return 'The speaker discusses a health-related topic.';
    case 'fear':
      return 'The speaker expresses or describes fear.';
    case 'urgency':
      return 'The speaker conveys time pressure or urgency.';
    case 'controversy':
      return 'The speaker raises a topic likely to provoke disagreement.';
    case 'achievement':
      return 'The speaker describes a notable accomplishment.';
    case 'transformation':
      return 'The speaker describes a significant change over time.';
    case 'life_lesson':
      return 'The speaker shares a lesson learned from experience.';
    default:
      return assertNeverSemanticEventType(type);
  }
}
