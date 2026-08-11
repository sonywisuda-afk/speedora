import type { ClipScores, FusionInput } from '@speedora/contracts';
import { Prisma } from '@speedora/database';
import type { RenderGraphResult } from './index';

// Node ids don't match FUSION_SIGNALS keys 1:1 (sceneFeatures -> scene, motionEnergyFeatures ->
// sceneMotion, faceLandmarkFeatures -> faceGeometry, ...) - this table is the one place that
// translation happens. `keyof FusionInput` on the value type makes a typo a compile error, not a
// silent no-op. Fields that are always present (never null) work identically to fields that are
// optional-null-becomes-undefined through the same loop below - a value that's never null always
// passes the `!= null` check, so no separate code path is needed for the two cases.
const FUSION_INPUT_MAP: Partial<Record<keyof RenderGraphResult, keyof FusionInput>> = {
  audioFeatures: 'audio',
  sceneFeatures: 'scene',
  motionEnergyFeatures: 'sceneMotion',
  cameraMotionFeatures: 'cameraMotion',
  editingRhythmFeatures: 'editingRhythm',
  facialFeatures: 'facial',
  gestureFeatures: 'gesture',
  faceLandmarkFeatures: 'faceGeometry',
  ocrFeatures: 'ocr',
  objectFeatures: 'object',
  speakerFusionFeatures: 'speaker',
  compositionFeatures: 'composition',
};

// Assembles computeHighlightScore()'s input from the graph's result. `scores` is passed
// separately, not through the map above - it's a job-payload value (this clip's own Fase 8
// Content Intelligence scores), not a graph node.
export function toFusionInput(
  result: RenderGraphResult,
  clipId: string,
  scores: ClipScores | null,
): FusionInput {
  const input: Record<string, unknown> = { clipId, llm: scores ?? undefined };
  for (const [nodeId, fusionKey] of Object.entries(FUSION_INPUT_MAP) as Array<
    [keyof RenderGraphResult, keyof FusionInput]
  >) {
    const value = result[nodeId];
    if (value != null) input[fusionKey] = value;
  }
  return input as FusionInput;
}

// Node -> Prisma.ClipUpdateInput. Deliberately NOT a plain rename table like FUSION_INPUT_MAP
// above - some nodes fan out to multiple columns (speakerScores -> 4 speaker*Scores/Moments
// columns), and Prisma.JsonNull vs. a plain value differs per column (a Float[]/plain-JSON-array
// column like sceneCuts/motionEnergy is never JsonNull; every nullable single-object Json column
// is JsonNull when its node resolved to null; a handful of nodes - motionEnergyFeatures,
// editingRhythmFeatures, audioFeatures, sceneFeatures, compositionFeatures - are always-computed
// non-nullable objects and need neither `?? Prisma.JsonNull` nor an `undefined` fallback). One
// small function per node keeps each of those differences local and explicit instead of trying to
// force them into one shared rule.
const CLIP_UPDATE_MAP: {
  [K in keyof RenderGraphResult]?: (r: RenderGraphResult) => Partial<Prisma.ClipUpdateInput>;
} = {
  sceneCuts: (r) => ({ sceneCuts: r.sceneCuts }),
  sceneCutEvents: (r) => ({ sceneCutEvents: r.sceneCutEvents ?? Prisma.JsonNull }),
  // motionEnergy is a plain JSON array (never JsonNull, always an array) - cast the same way
  // llmFeatures is (MotionEnergySample[] is a closed type with no index signature, which
  // Prisma's Json input type requires).
  motionEnergy: (r) => ({ motionEnergy: r.motionEnergy as unknown as Prisma.InputJsonValue }),
  motionEnergyFeatures: (r) => ({ motionEnergyFeatures: r.motionEnergyFeatures }),
  cameraMotion: (r) => ({ cameraMotion: r.cameraMotion ?? Prisma.JsonNull }),
  cameraMotionFeatures: (r) => ({
    cameraMotionFeatures: r.cameraMotionFeatures ?? Prisma.JsonNull,
  }),
  editingRhythmFeatures: (r) => ({ editingRhythmFeatures: r.editingRhythmFeatures }),
  facialEmotions: (r) => ({ facialEmotions: r.facialEmotions ?? Prisma.JsonNull }),
  gestures: (r) => ({ gestures: r.gestures ?? Prisma.JsonNull }),
  audioFeatures: (r) => ({ audioFeatures: r.audioFeatures }),
  sceneFeatures: (r) => ({ sceneFeatures: r.sceneFeatures }),
  facialFeatures: (r) => ({ facialFeatures: r.facialFeatures ?? Prisma.JsonNull }),
  gestureFeatures: (r) => ({ gestureFeatures: r.gestureFeatures ?? Prisma.JsonNull }),
  faceLandmarks: (r) => ({ faceLandmarks: r.faceLandmarks ?? Prisma.JsonNull }),
  faceLandmarkFeatures: (r) => ({
    faceLandmarkFeatures: r.faceLandmarkFeatures ?? Prisma.JsonNull,
  }),
  trackingQualityMetrics: (r) => ({
    trackingQualityMetrics: r.trackingQualityMetrics ?? Prisma.JsonNull,
  }),
  activeSpeakerSamples: (r) => ({
    activeSpeakerSamples: r.activeSpeakerSamples ?? Prisma.JsonNull,
  }),
  speakerFaceAssociations: (r) => ({
    speakerFaceAssociations: r.speakerFaceAssociations ?? Prisma.JsonNull,
  }),
  lipSyncVerifications: (r) => ({
    lipSyncVerifications: r.lipSyncVerifications ?? Prisma.JsonNull,
  }),
  speakerTimeline: (r) => ({ speakerTimeline: r.speakerTimeline ?? Prisma.JsonNull }),
  speakerTimelineFeatures: (r) => ({
    speakerTimelineFeatures: r.speakerTimelineFeatures ?? Prisma.JsonNull,
  }),
  speakerScores: (r) => ({
    speakerConfidenceScores: r.speakerScores?.confidence ?? Prisma.JsonNull,
    speakerEngagementScores: r.speakerScores?.engagement ?? Prisma.JsonNull,
    speakerImportanceScores: r.speakerScores?.importance ?? Prisma.JsonNull,
    speakerHighlightMoments: r.speakerScores?.highlightMoments ?? Prisma.JsonNull,
  }),
  ocrText: (r) => ({ ocrText: r.ocrText ?? Prisma.JsonNull }),
  ocrTracks: (r) => ({ ocrTracks: r.ocrTracks ?? Prisma.JsonNull }),
  ocrFeatures: (r) => ({ ocrFeatures: r.ocrFeatures ?? Prisma.JsonNull }),
  objects: (r) => ({ objects: r.objects ?? Prisma.JsonNull }),
  objectTracks: (r) => ({ objectTracks: r.objectTracks ?? Prisma.JsonNull }),
  objectFeatures: (r) => ({ objectFeatures: r.objectFeatures ?? Prisma.JsonNull }),
  compositionFeatures: (r) => ({ compositionFeatures: r.compositionFeatures }),
  // AI Intelligence v4, Phase 1 (Hook Prediction Engine - see docs/ai/
  // intelligence-v4.md, ADR D1) - deliberately NOT added to FUSION_INPUT_MAP
  // above: v4 predictions sit BESIDE the Fusion Engine, they don't feed
  // computeHighlightScore. hookPauseFeatures (the node id) has no column of
  // its own - only the final hookPrediction output is persisted.
  hookPrediction: (r) => ({ hookPrediction: r.hookPrediction ?? Prisma.JsonNull }),
  // AI Intelligence v4, Phase 2 (Semantic Event Detection - see docs/ai/
  // intelligence-v4.md, ADR D1) - same "NOT added to FUSION_INPUT_MAP"
  // posture as hookPrediction above; both v4 outputs sit beside the Fusion
  // Engine, never feed it.
  semanticEvents: (r) => ({ semanticEvents: r.semanticEvents ?? Prisma.JsonNull }),
  // AI Intelligence v4, Phase 3 (Narrative Graph - see docs/ai/
  // intelligence-v4.md, ADR D1) - same "NOT added to FUSION_INPUT_MAP"
  // posture as hookPrediction/semanticEvents above. A present value
  // (including the `unsegmented: true` case) is written through directly,
  // never coerced to JsonNull - only a genuinely failed/never-run node
  // (null) becomes Prisma.JsonNull.
  narrativeGraph: (r) => ({ narrativeGraph: r.narrativeGraph ?? Prisma.JsonNull }),
  // AI Intelligence v4, Phase 4 (Contextual Momentum - see docs/ai/
  // intelligence-v4.md, ADR D1) - same "NOT added to FUSION_INPUT_MAP"
  // posture as every prior v4 output, worth calling out explicitly since
  // this signal structurally resembles editingRhythmFeatures (which DOES
  // feed Fusion Engine v2) - v4 stays categorically separate regardless.
  // Unlike Phases 1-3, this node is optional: false and can't produce
  // null - always a plain JSON array (never Prisma.JsonNull, even when
  // empty), same cast reasoning as motionEnergy above (a closed array type
  // with no index signature).
  contextualMomentum: (r) => ({
    contextualMomentum: r.contextualMomentum as unknown as Prisma.InputJsonValue,
  }),
  // AI Intelligence v4, Phase 5 (Emotional Arc - see docs/ai/
  // intelligence-v4.md) - same "NOT added to FUSION_INPUT_MAP" posture as
  // every prior v4 output. Unlike Phases 1-3, this node is optional: false
  // and can't produce null - always a plain JSON array (never
  // Prisma.JsonNull, even when empty), same cast reasoning as
  // contextualMomentum/motionEnergy above (a closed array type with no
  // index signature).
  emotionalArc: (r) => ({
    emotionalArc: r.emotionalArc as unknown as Prisma.InputJsonValue,
  }),
  // AI Intelligence v4, Phase 6 (Multi-speaker Reasoning - see docs/ai/
  // intelligence-v4.md) - same "NOT added to FUSION_INPUT_MAP" posture as
  // every prior v4 output. Unlike Phase 4/5's own always-array outputs,
  // this node's result is genuinely `T[] | null` even on success (null for
  // the majority single-speaker case, by design) - so this uses the
  // Phase 1-3 `?? Prisma.JsonNull` sink pattern, not the plain-cast-
  // never-JsonNull pattern Phase 4/5 used for their always-array outputs.
  multiSpeakerBreakdown: (r) => ({
    multiSpeakerBreakdown: r.multiSpeakerBreakdown ?? Prisma.JsonNull,
  }),
  // AI Intelligence v4, Phase 7 (Cross-module Fusion, spec Part 4 -
  // Virality Engine - see docs/ai/intelligence-v4.md) - same "NOT added to
  // FUSION_INPUT_MAP" posture as every prior v4 output. Unlike
  // multiSpeakerBreakdown's own third null-semantics pattern, this node
  // always produces a real object once it runs (no "doesn't apply to the
  // majority case" analog here) - so it follows the same "always-computed
  // non-nullable object" convention as audioFeatures/editingRhythmFeatures/
  // compositionFeatures above: a plain passthrough, no Prisma.JsonNull, no
  // InputJsonValue cast needed (object shapes, unlike closed array types,
  // don't need the array-specific cast).
  viralityPrediction: (r) => ({ viralityPrediction: r.viralityPrediction }),
  // AI Intelligence v4, Phase 10 (Retention Curve Insights, spec Part 5
  // extension - see docs/ai/intelligence-v4.md) - same "NOT added to
  // FUSION_INPUT_MAP" posture as every prior v4 output. Same
  // "always-computed non-nullable object" convention as
  // viralityPrediction above: a plain passthrough, no Prisma.JsonNull, no
  // InputJsonValue cast (an object whose own array fields can be empty,
  // never itself null).
  retentionCurveInsights: (r) => ({ retentionCurveInsights: r.retentionCurveInsights }),
  // AI Intelligence v4 Track B, Phase A1 (Subtitle Rewriter, spec Part 7 -
  // see docs/ai/subtitle-intelligence.md) - same "NOT added to
  // FUSION_INPUT_MAP" posture as every Track A v4 output (DB1/DB2 - this
  // sits beside the Fusion Engine, never feeds it). Same "always-computed
  // non-nullable object" convention as viralityPrediction/
  // retentionCurveInsights above: a plain passthrough, no Prisma.JsonNull,
  // no InputJsonValue cast needed.
  subtitleIntelligence: (r) => ({ subtitleIntelligence: r.subtitleIntelligence }),
  // AI Intelligence v4 Track B, Phase B1 (Dynamic Caption Engine, spec
  // Part 8 - data only, see docs/ai/subtitle-intelligence.md) - same "NOT
  // added to FUSION_INPUT_MAP" posture as every v4 output (DB1/DB2 - this
  // sits beside the Fusion Engine, never feeds it). Same "always a real
  // array, never JsonNull" convention as contextualMomentum/emotionalArc -
  // a closed array type with no index signature, cast through as
  // InputJsonValue.
  captionTreatment: (r) => ({
    captionTreatment: r.captionTreatment as unknown as Prisma.InputJsonValue,
  }),
  // AI Intelligence v4, Phase 11 (Multimodal Reasoning Engine, spec Part 6 -
  // see docs/ai/intelligence-v4.md) - same "NOT added to FUSION_INPUT_MAP"
  // posture as every prior v4 output. Same null-semantics as
  // hookPrediction/semanticEvents/narrativeGraph (Phase 1-3's own
  // "?? Prisma.JsonNull" pattern), not Phase 4/5/7/10's "always a real
  // object" pattern - this node IS LLM-backed (optional: true, fallback:
  // null) and can genuinely fail/never run.
  multimodalReasoning: (r) => ({
    multimodalReasoning: r.multimodalReasoning ?? Prisma.JsonNull,
  }),
  // AI Intelligence v4 Track B, Phase C1 (Visual Emphasis Engine, spec Part
  // 9 - data only, see docs/ai/visual-emphasis-engine.md) - same "NOT
  // added to FUSION_INPUT_MAP" posture as every v4 output (DB1/DB2 - this
  // sits beside the Fusion Engine, never feeds it). Same "always a real
  // array, never JsonNull" convention as contextualMomentum/emotionalArc/
  // captionTreatment above - a closed array type with no index signature,
  // cast through as InputJsonValue.
  editingSuggestions: (r) => ({
    editingSuggestions: r.editingSuggestions as unknown as Prisma.InputJsonValue,
  }),
  // Phase 4 of the thumbnail roadmap (AI Thumbnail Selection, Level 2) -
  // never added to FUSION_INPUT_MAP above: per this module's own policy
  // (see @speedora/contracts' thumbnail-selection.ts), this output must
  // never feed highlightScore.
  thumbnailSelection: (r) => ({
    thumbnailSelectionTimestamp: r.thumbnailSelection.timestampSeconds,
    thumbnailSelectionBreakdown: r.thumbnailSelection
      .contributions as unknown as Prisma.InputJsonValue,
    thumbnailSelectionFallback: r.thumbnailSelection.fallbackLevel,
    thumbnailSelectionReason: r.thumbnailSelection.reason,
  }),
  // Speaker Intelligence Phase C (Conversation Dynamics - see docs/ai/
  // speaker-intelligence.md) - NOT added to FUSION_INPUT_MAP above: this is
  // a ranking-signal candidate for Phase D (Clip Ranking Engine), not a
  // Fusion Engine v2 input. optional: false, always a real object (never
  // Prisma.JsonNull) - same cast reasoning as compositionFeatures/
  // contextualMomentum above. Fans out to 2 columns, same "one node, several
  // columns" shape as speakerScores.
  conversationIntelligence: (r) => ({
    conversationDynamics: r.conversationIntelligence.dynamics as unknown as Prisma.InputJsonValue,
    conversationType: r.conversationIntelligence.classification as unknown as Prisma.InputJsonValue,
  }),
};

// Assembles the graph-derived portion of prisma.clip.update()'s data object. `extra` carries
// every non-graph field (outputUrl, llmFeatures, and the highlight* fields from
// computeHighlightScore()'s own separate output) - this function only ever owns the fields listed
// in CLIP_UPDATE_MAP above.
export function toClipUpdateData(
  result: RenderGraphResult,
  extra: Prisma.ClipUpdateInput,
): Prisma.ClipUpdateInput {
  return Object.assign(
    {},
    extra,
    ...Object.values(CLIP_UPDATE_MAP).map((toFields) => toFields(result)),
  );
}
