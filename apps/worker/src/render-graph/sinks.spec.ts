import { Prisma } from '@speedora/database';
import { toClipUpdateData, toFusionInput } from './sinks';
import type { RenderGraphResult } from './index';

const noSceneFeatures = {
  cutCount: 0,
  cutsPerMinute: 0,
  averageSegmentSeconds: 10,
  hardCutCount: 0,
  fadeCount: 0,
  dissolveCount: 0,
};
const noMotionEnergyFeatures = {
  averageMotionEnergy: null,
  dynamicRatio: null,
  motionVariability: null,
  peakCount: null,
  peakTimestamps: null,
  peakMotionEnergy: null,
  peakRatePerMinute: null,
  staticRatio: null,
};
const noAudioFeatures = {
  averageRmsDb: null,
  averageSpeakingRateWordsPerSecond: null,
  peakDb: null,
  speakingRateStdDev: null,
};
const noEditingRhythmFeatures = { tempoScore: null, pacingScore: null, accelerationScore: null };
const noCompositionFeatures = {
  ruleOfThirdsScore: null,
  headroomScore: null,
  leadRoomScore: null,
  centeringScore: null,
  subjectLossRatio: null,
  compositionStability: null,
  framingConsistency: null,
};

function baseResult(overrides: Partial<RenderGraphResult> = {}): RenderGraphResult {
  return {
    sceneCuts: [],
    sceneCutEvents: null,
    motionEnergy: [],
    cameraMotion: null,
    sceneFeatures: noSceneFeatures,
    motionEnergyFeatures: noMotionEnergyFeatures,
    cameraMotionFeatures: null,
    facialEmotions: null,
    gestures: null,
    facialFeatures: null,
    gestureFeatures: null,
    faceLandmarks: null,
    faceLandmarkFeatures: null,
    trackingQualityMetrics: null,
    activeSpeakerSamples: null,
    speakerFaceAssociations: null,
    lipSyncVerifications: null,
    speakerTimeline: null,
    speakerTimelineFeatures: null,
    speakerScores: null,
    speakerFusionFeatures: null,
    ocrText: null,
    ocrTracks: null,
    ocrFeatures: null,
    objects: null,
    objectTracks: null,
    objectFeatures: null,
    primarySubjectSamples: [],
    compositionFeatures: noCompositionFeatures,
    audioFeatures: noAudioFeatures,
    editingRhythmFeatures: noEditingRhythmFeatures,
    ...overrides,
  };
}

describe('toFusionInput', () => {
  it('passes always-present fields through directly under their own FUSION_SIGNALS key names', () => {
    const input = toFusionInput(baseResult(), 'clip-1', null);
    expect(input.clipId).toBe('clip-1');
    expect(input.audio).toBe(noAudioFeatures);
    expect(input.scene).toBe(noSceneFeatures);
    expect(input.sceneMotion).toBe(noMotionEnergyFeatures);
    expect(input.editingRhythm).toBe(noEditingRhythmFeatures);
    expect(input.composition).toBe(noCompositionFeatures);
  });

  it('omits optional-null fields entirely (they read as undefined, not null)', () => {
    const input = toFusionInput(baseResult(), 'clip-1', null);
    expect(input.cameraMotion).toBeUndefined();
    expect(input.facial).toBeUndefined();
    expect(input.gesture).toBeUndefined();
    expect(input.faceGeometry).toBeUndefined();
    expect(input.ocr).toBeUndefined();
    expect(input.object).toBeUndefined();
    expect(input.speaker).toBeUndefined();
  });

  it('maps a present optional field under its FUSION_SIGNALS name, not its node id', () => {
    const objectFeatures = {
      objectCount: 1,
      dominantObject: 'person',
      averageObjectsPerFrame: 1,
      averageTrackingConfidence: 0.9,
      averagePersistence: 1,
      averageMotionSpeed: null,
      averageOcclusionScore: 0,
      averageInteractionConfidence: 0,
      averageAttentionScore: 0.5,
      averageAttentionConfidence: 0.5,
    };
    const input = toFusionInput(baseResult({ objectFeatures }), 'clip-1', null);
    expect(input.object).toBe(objectFeatures);
  });

  it('passes scores through under `llm`, separately from the node map', () => {
    const scores = { hookStrength: 80 } as never;
    const input = toFusionInput(baseResult(), 'clip-1', scores);
    expect(input.llm).toBe(scores);
  });

  it('omits `llm` entirely when scores is null', () => {
    const input = toFusionInput(baseResult(), 'clip-1', null);
    expect(input.llm).toBeUndefined();
  });
});

describe('toClipUpdateData', () => {
  it('writes a plain array (never Prisma.JsonNull) for sceneCuts even when empty', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.sceneCuts).toEqual([]);
  });

  it('writes Prisma.JsonNull (not plain null) for a null optional signal', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.cameraMotion).toBe(Prisma.JsonNull);
    expect(data.faceLandmarks).toBe(Prisma.JsonNull);
    expect(data.objectFeatures).toBe(Prisma.JsonNull);
  });

  it('writes an always-present object directly, with no JsonNull wrapping', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.audioFeatures).toBe(noAudioFeatures);
    expect(data.sceneFeatures).toBe(noSceneFeatures);
    expect(data.compositionFeatures).toBe(noCompositionFeatures);
  });

  it('fans speakerScores out to its 4 own columns, each independently JsonNull when speakerScores itself is null', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.speakerConfidenceScores).toBe(Prisma.JsonNull);
    expect(data.speakerEngagementScores).toBe(Prisma.JsonNull);
    expect(data.speakerImportanceScores).toBe(Prisma.JsonNull);
    expect(data.speakerHighlightMoments).toBe(Prisma.JsonNull);
  });

  it('fans a present speakerScores out to its 4 own columns using its own sub-fields', () => {
    const speakerScores = {
      confidence: { x: 1 },
      engagement: { y: 2 },
      importance: { z: 3 },
      highlightMoments: [{ w: 4 }],
    } as never;
    const data = toClipUpdateData(baseResult({ speakerScores }), {
      outputUrl: 'renders/clip-1.mp4',
    });
    expect(data.speakerConfidenceScores).toEqual({ x: 1 });
    expect(data.speakerEngagementScores).toEqual({ y: 2 });
    expect(data.speakerImportanceScores).toEqual({ z: 3 });
    expect(data.speakerHighlightMoments).toEqual([{ w: 4 }]);
  });

  it('preserves every field passed in `extra` (outputUrl, llmFeatures, highlight* fields)', () => {
    const data = toClipUpdateData(baseResult(), {
      outputUrl: 'renders/clip-1.mp4',
      highlightScore: 42,
      highlightReason: 'because',
    });
    expect(data.outputUrl).toBe('renders/clip-1.mp4');
    expect(data.highlightScore).toBe(42);
    expect(data.highlightReason).toBe('because');
  });

  it('casts motionEnergy through as an InputJsonValue, never Prisma.JsonNull, even when empty', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.motionEnergy).toEqual([]);
  });
});
