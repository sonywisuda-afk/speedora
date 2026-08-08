import type {
  EmotionalArc,
  HookPredictionOutput,
  MomentumCurve,
  MultiSpeakerBreakdown,
  NarrativeGraph,
  SemanticEvent,
  ViralityPrediction,
} from './video';

// AI Intelligence v4 (see docs/ai/intelligence-v4.md, ADR D9) - a separate
// DTO/endpoint from ClipExplainabilityDto (explainability.ts), deliberately.
// That DTO's `results` array exists to let alternate *highlightScore*
// engines (a single commensurable number) append a second entry; v4 is a
// growing family of unrelated predictions (hook probability today, virality/
// retention/narrative scores in future phases) that don't collapse into one
// number, so reusing that array would force a false equivalence. Phase 1
// shipped `hookPrediction`; Phase 2 added `semanticEvents`; Phase 3 added
// `narrativeGraph`; Phase 4 added `contextualMomentum`; Phase 5 added
// `emotionalArc`; Phase 6 added `multiSpeakerBreakdown`; Phase 7 adds
// `viralityPrediction` to this same DTO rather than growing a new endpoint
// per part; later Track A phases follow the same pattern.
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
  // Null when NARRATIVE_GRAPH_ENABLED is off (same exposure-only gate, see
  // isNarrativeGraphEnabled()) or when the render-graph node's own LLM
  // call failed/never ran. A present object (flag on, node ran) - including
  // the `unsegmented: true` case - means it ran successfully.
  narrativeGraph: NarrativeGraph | null;
  // Null when CONTEXTUAL_MOMENTUM_ENABLED is off (same exposure-only gate,
  // see isContextualMomentumEnabled()) or when this Clip row predates the
  // phase's migration (the node itself is pure and can't fail the way
  // Phases 1-3's LLM-backed nodes can). An empty array (flag on, node ran)
  // means the clip had no motion-energy samples to build a curve from - a
  // real result.
  contextualMomentum: MomentumCurve | null;
  // Null when EMOTIONAL_ARC_ENABLED is off (same exposure-only gate, see
  // isEmotionalArcEnabled()) or when this Clip row predates the phase's
  // migration (same pure-node null-semantics as contextualMomentum above).
  // An empty array (flag on, node ran) means the clip had no transcript
  // segments to build an arc from - a real result.
  emotionalArc: EmotionalArc | null;
  // Null when MULTI_SPEAKER_REASONING_ENABLED is off (same exposure-only
  // gate, see isMultiSpeakerReasoningEnabled()), OR when this Clip row
  // predates the phase's migration, OR when the clip genuinely doesn't
  // have 2+ distinct speakers (the majority case, by design - see
  // computeMultiSpeakerBreakdown()'s own doc comment). These three causes
  // are not distinguished at this field's level. A present array (length
  // >= 2, sorted by talkTimeRatio descending) means the clip genuinely has
  // multiple speakers and was attributed successfully.
  multiSpeakerBreakdown: MultiSpeakerBreakdown | null;
  // Null when VIRALITY_ENGINE_ENABLED is off (same exposure-only gate, see
  // isViralityEngineEnabled()) or when this Clip row predates the phase's
  // migration (same pure-node null-semantics as contextualMomentum/
  // emotionalArc above, not multiSpeakerBreakdown's third pattern - this
  // node always produces a real object once it runs). NOT the same as
  // Clip.viralityScore (Fase 8's original MVP LLM clip-scoring) - see
  // docs/ai/scoring.md.
  viralityPrediction: ViralityPrediction | null;
}
