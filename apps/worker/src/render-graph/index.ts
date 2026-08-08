import type {
  ActiveSpeakerSample,
  AudioFeatures,
  CameraMotionFeatures,
  CameraMotionSample,
  CaptionTreatmentTimeline,
  CompositionFeatures,
  EditingRhythmFeatures,
  EditingSuggestionTimeline,
  EmotionalArc,
  FaceLandmarkFeatures,
  FaceTrackingQualityMetrics,
  FacialEmotionFeatures,
  FacialEmotionSample,
  GestureFeatures,
  GestureSample,
  HookPauseFeatures,
  HookPredictionOutput,
  LipSyncVerification,
  MomentumCurve,
  MotionEnergyFeatures,
  MotionEnergySample,
  MultimodalReasoningResult,
  MultiSpeakerBreakdown,
  NarrativeGraph,
  ObjectFeatures,
  ObjectSample,
  ObjectTrack,
  OcrFeatures,
  OcrSample,
  OcrTextTrack,
  PrimarySubjectSample,
  RetentionCurveInsights,
  SceneCutEvent,
  SceneFeatures,
  SelectThumbnailTimestampOutput,
  SemanticEvent,
  SpeakerFaceAssociation,
  SpeakerFusionFeatures,
  SpeakerTimelineEntry,
  SpeakerTimelineFeatures,
  SubtitleIntelligence,
  ViralityPrediction,
} from '@speedora/contracts';
import type { FaceLandmarkSample } from '@speedora/facial-intelligence';
import type { ClipSpeakerScores } from '@speedora/speaker-scoring';
import type { GraphNode } from './executor';
import type { RenderGraphContext } from './context';
import { audioEditingNodes } from './nodes/audio-editing';
import { compositionNodes } from './nodes/composition';
import { contextualMomentumNodes } from './nodes/contextual-momentum';
import { dynamicCaptionNodes } from './nodes/dynamic-caption';
import { emotionalArcNodes } from './nodes/emotional-arc';
import { facialGestureNodes } from './nodes/facial-gesture';
import { faceSpeakerNodes } from './nodes/face-speaker';
import { hookPredictionNodes } from './nodes/hook-prediction';
import { multimodalReasoningNodes } from './nodes/multimodal-reasoning';
import { multiSpeakerReasoningNodes } from './nodes/multi-speaker-reasoning';
import { narrativeGraphNodes } from './nodes/narrative-graph';
import { objectNodes } from './nodes/object';
import { ocrNodes } from './nodes/ocr';
import { retentionCurveInsightsNodes } from './nodes/retention-curve-insights';
import { sceneNodes } from './nodes/scene';
import { semanticEventNodes } from './nodes/semantic-events';
import { subtitleRewriterNodes } from './nodes/subtitle-rewriter';
import { thumbnailSelectionNodes } from './nodes/thumbnail-selection';
import { viralityEngineNodes } from './nodes/virality-engine';
import { visualEmphasisNodes } from './nodes/visual-emphasis';

export { runGraph, GraphConfigError, GraphCycleError, type GraphNode } from './executor';
export type { RenderGraphContext } from './context';
export { toClipUpdateData, toFusionInput } from './sinks';
export {
  onRenderGraphNodeFailure,
  runInstrumentedRenderGraph,
  RENDER_CLIP_GRAPH_VERSION,
} from './telemetry';

// The full render-clip graph - grows one node-group array at a time as more of
// render-clip.worker.ts's detectors/derive functions migrate in (see ARCHITECTURE.md's
// "Composing multiple modules" section for the migration order/rationale).
export const renderClipGraph: GraphNode<RenderGraphContext, unknown>[] = [
  ...sceneNodes,
  ...facialGestureNodes,
  ...faceSpeakerNodes,
  ...ocrNodes,
  ...objectNodes,
  ...compositionNodes,
  ...audioEditingNodes,
  ...hookPredictionNodes,
  ...semanticEventNodes,
  ...narrativeGraphNodes,
  ...contextualMomentumNodes,
  ...emotionalArcNodes,
  ...multiSpeakerReasoningNodes,
  ...viralityEngineNodes,
  ...retentionCurveInsightsNodes,
  ...multimodalReasoningNodes,
  // AI Intelligence v4 Track B, Phase A1 (Subtitle Rewriter) - a separate
  // track from the Phase 1-11 chain above (see docs/ai/
  // subtitle-intelligence.md); registration order here is stylistic, not
  // load-bearing - runGraph()'s own Kahn's-algorithm level batching orders
  // execution from each node's declared `deps`, not array position.
  ...subtitleRewriterNodes,
  // AI Intelligence v4 Track B, Phase B1 (Dynamic Caption Engine) - depends
  // on subtitleRewriterNodes (subtitleIntelligence) above, registration
  // order here is stylistic, not load-bearing (see the subtitleRewriterNodes
  // comment above).
  ...dynamicCaptionNodes,
  // AI Intelligence v4 Track B, Phase C1 (Visual Emphasis Engine, spec Part
  // 9) - depends on subtitleIntelligence (above), ocrTracks/
  // primarySubjectSamples/retentionCurveInsights (all already registered
  // earlier), registration order here is stylistic, not load-bearing (see
  // the subtitleRewriterNodes comment above).
  ...visualEmphasisNodes,
  ...thumbnailSelectionNodes,
];

// Grows alongside renderClipGraph above - one field per migrated node id. Callers do exactly one
// cast at this seam (`runGraph(...) as unknown as RenderGraphResult`), the same "trusted shape,
// one cast at a documented boundary" precedent ARCHITECTURE.md already uses for ClipScores.
export interface RenderGraphResult {
  sceneCuts: number[];
  sceneCutEvents: SceneCutEvent[] | null;
  motionEnergy: MotionEnergySample[];
  cameraMotion: CameraMotionSample[] | null;
  sceneFeatures: SceneFeatures;
  motionEnergyFeatures: MotionEnergyFeatures;
  cameraMotionFeatures: CameraMotionFeatures | null;
  facialEmotions: FacialEmotionSample[] | null;
  gestures: GestureSample[] | null;
  facialFeatures: FacialEmotionFeatures | null;
  gestureFeatures: GestureFeatures | null;
  faceLandmarks: FaceLandmarkSample[] | null;
  faceLandmarkFeatures: FaceLandmarkFeatures | null;
  trackingQualityMetrics: FaceTrackingQualityMetrics | null;
  activeSpeakerSamples: ActiveSpeakerSample[] | null;
  speakerFaceAssociations: SpeakerFaceAssociation[] | null;
  lipSyncVerifications: LipSyncVerification[] | null;
  speakerTimeline: SpeakerTimelineEntry[] | null;
  speakerTimelineFeatures: SpeakerTimelineFeatures | null;
  speakerScores: ClipSpeakerScores | null;
  speakerFusionFeatures: SpeakerFusionFeatures | null;
  ocrText: OcrSample[] | null;
  ocrTracks: OcrTextTrack[] | null;
  ocrFeatures: OcrFeatures | null;
  objects: ObjectSample[] | null;
  objectTracks: ObjectTrack[] | null;
  objectFeatures: ObjectFeatures | null;
  primarySubjectSamples: PrimarySubjectSample[];
  compositionFeatures: CompositionFeatures;
  audioFeatures: AudioFeatures;
  editingRhythmFeatures: EditingRhythmFeatures;
  hookPauseFeatures: HookPauseFeatures;
  hookPrediction: HookPredictionOutput | null;
  semanticEvents: SemanticEvent[] | null;
  narrativeGraph: NarrativeGraph | null;
  contextualMomentum: MomentumCurve;
  emotionalArc: EmotionalArc;
  multiSpeakerBreakdown: MultiSpeakerBreakdown | null;
  viralityPrediction: ViralityPrediction;
  retentionCurveInsights: RetentionCurveInsights;
  multimodalReasoning: MultimodalReasoningResult | null;
  subtitleIntelligence: SubtitleIntelligence;
  captionTreatment: CaptionTreatmentTimeline;
  editingSuggestions: EditingSuggestionTimeline;
  thumbnailSelection: SelectThumbnailTimestampOutput;
}
