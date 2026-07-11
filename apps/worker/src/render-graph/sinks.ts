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
