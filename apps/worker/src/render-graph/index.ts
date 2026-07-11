import type {
  ActiveSpeakerSample,
  AudioFeatures,
  CameraMotionFeatures,
  CameraMotionSample,
  CompositionFeatures,
  EditingRhythmFeatures,
  FaceLandmarkFeatures,
  FaceTrackingQualityMetrics,
  FacialEmotionFeatures,
  FacialEmotionSample,
  GestureFeatures,
  GestureSample,
  LipSyncVerification,
  MotionEnergyFeatures,
  MotionEnergySample,
  ObjectFeatures,
  ObjectSample,
  ObjectTrack,
  OcrFeatures,
  OcrSample,
  OcrTextTrack,
  PrimarySubjectSample,
  SceneCutEvent,
  SceneFeatures,
  SpeakerFaceAssociation,
  SpeakerFusionFeatures,
  SpeakerTimelineEntry,
  SpeakerTimelineFeatures,
} from '@speedora/contracts';
import type { FaceLandmarkSample } from '@speedora/facial-intelligence';
import type { ClipSpeakerScores } from '@speedora/speaker-scoring';
import type { GraphNode } from './executor';
import type { RenderGraphContext } from './context';
import { audioEditingNodes } from './nodes/audio-editing';
import { compositionNodes } from './nodes/composition';
import { facialGestureNodes } from './nodes/facial-gesture';
import { faceSpeakerNodes } from './nodes/face-speaker';
import { objectNodes } from './nodes/object';
import { ocrNodes } from './nodes/ocr';
import { sceneNodes } from './nodes/scene';

export { runGraph, GraphConfigError, GraphCycleError, type GraphNode } from './executor';
export type { RenderGraphContext } from './context';
export { toClipUpdateData, toFusionInput } from './sinks';

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
}

// Reproduces render-clip.worker.ts's exact pre-graph warn-message format
// (`[render-clip] ${label} failed for clip ${clipId}, continuing without ${dataLabel}:`) - kept
// here (render-clip-specific), not in executor.ts (which stays generic and knows nothing about
// this wording or about `clipId`).
export function onRenderGraphNodeFailure(
  node: GraphNode<RenderGraphContext, unknown>,
  error: unknown,
  ctx: RenderGraphContext,
): void {
  console.warn(
    `[render-clip] ${node.label} failed for clip ${ctx.clipId}, continuing without ${node.dataLabel}:`,
    error,
  );
}
