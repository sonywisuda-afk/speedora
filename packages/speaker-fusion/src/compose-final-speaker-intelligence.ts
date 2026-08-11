import type {
  ComposeFinalSpeakerIntelligenceInput,
  FinalSpeakerIntelligence,
} from '@speedora/contracts';

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Speaker Intelligence Phase F ("Cross-module Fusion" - see docs/ai/
// speaker-intelligence.md and @speedora/contracts' speaker-fusion.ts own
// design comment for the full reasoning). Pure reshape/composition, no new
// derivation: each output branch maps 1:1 from an already-computed input,
// preserving that input's own null-semantics rather than collapsing
// anything into a fabricated default. Deliberately does NOT compute a
// top-level composite score - the explicit product decision (Phase F's own
// scoping conversation) was a structured, orthogonal 3-branch read-model,
// not a naive sum-everything-into-one-number fusion.
export function composeFinalSpeakerIntelligence(
  input: ComposeFinalSpeakerIntelligenceInput,
): FinalSpeakerIntelligence {
  const conversation =
    input.conversationDynamics === null || input.conversationType === null
      ? null
      : {
          type: input.conversationType.type,
          turnDensity: input.conversationDynamics.turnDensityPerMinute,
          backAndForthScore: input.conversationDynamics.backAndForthScore,
          responseLatency: input.conversationDynamics.responseLatencySeconds,
          overlapRatio: input.conversationDynamics.overlapRatio,
        };

  const speaker =
    input.speakerFusionFeatures === null
      ? null
      : {
          confidence: input.speakerFusionFeatures.dominantSpeakerConfidence,
          engagement: input.speakerFusionFeatures.dominantSpeakerEngagement,
          importance: input.speakerFusionFeatures.dominantSpeakerImportance,
          highlight: input.speakerFusionFeatures.averageSpeakerHighlightScore,
        };

  return {
    clipId: input.clipId,
    conversation,
    speaker,
    // Diagnostic only (see the contract's own comment on why this is never
    // folded into a score alongside `conversation` above) - a real,
    // possibly-zero-count object, never null itself.
    visual: {
      speakerFocusShift: {
        count: input.speakerFocusShiftScores.length,
        averageConfidence: average(input.speakerFocusShiftScores),
      },
    },
  };
}
