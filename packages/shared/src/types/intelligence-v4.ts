import type { HookPredictionOutput, SemanticEvent } from './video';

// AI Intelligence v4 (see docs/ai/intelligence-v4.md, ADR D9) - a separate
// DTO/endpoint from ClipExplainabilityDto (explainability.ts), deliberately.
// That DTO's `results` array exists to let alternate *highlightScore*
// engines (a single commensurable number) append a second entry; v4 is a
// growing family of unrelated predictions (hook probability today, virality/
// retention/narrative scores in future phases) that don't collapse into one
// number, so reusing that array would force a false equivalence. Phase 1
// shipped `hookPrediction`; Phase 2 adds `semanticEvents` to this same DTO
// rather than growing a new endpoint per part; later Track A phases follow
// the same pattern.
export interface ClipIntelligenceDto {
  clipId: string;
  // Null when HOOK_PREDICTION_ENABLED is off (the flag gates this field's
  // exposure, not whether it was computed - see isHookPredictionEnabled())
  // or when the render-graph node's own LLM call failed.
  hookPrediction: HookPredictionOutput | null;
  // Null when SEMANTIC_EVENT_DETECTION_ENABLED is off (same exposure-only
  // gate, see isSemanticEventDetectionEnabled()) or when the render-graph
  // node's own LLM call failed/never ran. An empty array (flag on, node
  // ran) means it genuinely found zero events - a real result.
  semanticEvents: SemanticEvent[] | null;
}
