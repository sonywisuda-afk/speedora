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
const noHookPauseFeatures = { pauseCount: 0, longestPauseSeconds: 0, pauseBeforeHookRatio: 0 };
const noViralityPrediction = {
  clipId: 'clip-1',
  overallViralScore: null,
  confidence: 0,
  reason: 'Not enough signals were available to estimate virality potential.',
  subProbabilities: {
    scrollStopProbability: null,
    watchProbability: null,
    completionProbability: null,
    shareProbability: null,
    commentProbability: null,
    saveProbability: null,
    followProbability: null,
  },
};
const midpointThumbnailSelection = {
  timestampSeconds: 5,
  confidence: 0,
  contributions: [],
  fallbackLevel: 'midpoint' as const,
  reason: 'no timed signals available, falling back to clip midpoint',
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
    hookPauseFeatures: noHookPauseFeatures,
    hookPrediction: null,
    semanticEvents: null,
    narrativeGraph: null,
    contextualMomentum: [],
    emotionalArc: [],
    multiSpeakerBreakdown: null,
    viralityPrediction: noViralityPrediction,
    thumbnailSelection: midpointThumbnailSelection,
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

  // AI Intelligence v4 (ADR D1, docs/ai/intelligence-v4.md) - v4 predictions
  // sit BESIDE the Fusion Engine, they never feed computeHighlightScore.
  // Regression guard: a present hookPrediction must never leak into
  // FusionInput under any key.
  it('never includes hookPrediction/hookPauseFeatures/semanticEvents/narrativeGraph/contextualMomentum/emotionalArc/multiSpeakerBreakdown/viralityPrediction in FusionInput', () => {
    const hookPrediction = { clipId: 'clip-1', hookProbability: 90 } as never;
    const semanticEvents = [{ type: 'money', t: 5 }] as never;
    const narrativeGraph = { segments: [], relations: [], unsegmented: true } as never;
    const contextualMomentum = [{ t: 0, momentumScore: 0.5 }] as never;
    const emotionalArc = [{ t: 0, emotion: 'neu', intensity: 0.1 }] as never;
    const multiSpeakerBreakdown = [{ speaker: 'Speaker A', talkTimeRatio: 1 } as never] as never;
    const viralityPrediction = { clipId: 'clip-1', overallViralScore: 0.5 } as never;
    const input = toFusionInput(
      baseResult({
        hookPrediction,
        semanticEvents,
        narrativeGraph,
        contextualMomentum,
        emotionalArc,
        multiSpeakerBreakdown,
        viralityPrediction,
      }),
      'clip-1',
      null,
    );
    expect(Object.values(input)).not.toContain(hookPrediction);
    expect(Object.values(input)).not.toContain(semanticEvents);
    expect(Object.values(input)).not.toContain(narrativeGraph);
    expect(Object.values(input)).not.toContain(contextualMomentum);
    expect(Object.values(input)).not.toContain(emotionalArc);
    expect(Object.values(input)).not.toContain(multiSpeakerBreakdown);
    expect(Object.values(input)).not.toContain(viralityPrediction);
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
    expect(data.hookPrediction).toBe(Prisma.JsonNull);
    expect(data.semanticEvents).toBe(Prisma.JsonNull);
    expect(data.narrativeGraph).toBe(Prisma.JsonNull);
    expect(data.multiSpeakerBreakdown).toBe(Prisma.JsonNull);
  });

  it('writes a present hookPrediction through directly (no hookPauseFeatures column of its own)', () => {
    const hookPrediction = { clipId: 'clip-1', hookProbability: 77 } as never;
    const data = toClipUpdateData(baseResult({ hookPrediction }), {
      outputUrl: 'renders/clip-1.mp4',
    });
    expect(data.hookPrediction).toBe(hookPrediction);
    expect(data).not.toHaveProperty('hookPauseFeatures');
  });

  it('writes a present (including empty-array) semanticEvents through directly, never JsonNull', () => {
    const emptyEvents: never[] = [];
    const data = toClipUpdateData(baseResult({ semanticEvents: emptyEvents }), {
      outputUrl: 'renders/clip-1.mp4',
    });
    expect(data.semanticEvents).toBe(emptyEvents);
    expect(data.semanticEvents).not.toBe(Prisma.JsonNull);
  });

  it('writes a present narrativeGraph through directly (including the unsegmented case), never JsonNull', () => {
    const narrativeGraph = { segments: [], relations: [], unsegmented: true } as never;
    const data = toClipUpdateData(baseResult({ narrativeGraph }), {
      outputUrl: 'renders/clip-1.mp4',
    });
    expect(data.narrativeGraph).toBe(narrativeGraph);
    expect(data.narrativeGraph).not.toBe(Prisma.JsonNull);
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

  it('casts contextualMomentum through as an InputJsonValue, never Prisma.JsonNull, even when empty', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.contextualMomentum).toEqual([]);
    expect(data.contextualMomentum).not.toBe(Prisma.JsonNull);
  });

  it('writes a present contextualMomentum curve through directly', () => {
    const contextualMomentum = [{ t: 0, momentumScore: 0.5 }] as never;
    const data = toClipUpdateData(baseResult({ contextualMomentum }), {
      outputUrl: 'renders/clip-1.mp4',
    });
    expect(data.contextualMomentum).toBe(contextualMomentum);
  });

  it('casts emotionalArc through as an InputJsonValue, never Prisma.JsonNull, even when empty', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.emotionalArc).toEqual([]);
    expect(data.emotionalArc).not.toBe(Prisma.JsonNull);
  });

  it('writes a present emotionalArc through directly', () => {
    const emotionalArc = [{ t: 0, emotion: 'neu', intensity: 0.1 }] as never;
    const data = toClipUpdateData(baseResult({ emotionalArc }), {
      outputUrl: 'renders/clip-1.mp4',
    });
    expect(data.emotionalArc).toBe(emotionalArc);
  });

  it('writes Prisma.JsonNull (not plain null) for a null multiSpeakerBreakdown - the majority single-speaker case', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.multiSpeakerBreakdown).toBe(Prisma.JsonNull);
  });

  it('writes a present multiSpeakerBreakdown through directly, never Prisma.JsonNull', () => {
    const multiSpeakerBreakdown = [{ speaker: 'Speaker A', talkTimeRatio: 1 }] as never;
    const data = toClipUpdateData(baseResult({ multiSpeakerBreakdown }), {
      outputUrl: 'renders/clip-1.mp4',
    });
    expect(data.multiSpeakerBreakdown).toBe(multiSpeakerBreakdown);
    expect(data.multiSpeakerBreakdown).not.toBe(Prisma.JsonNull);
  });

  it('writes viralityPrediction through as a plain passthrough, never Prisma.JsonNull (always-computed object)', () => {
    const data = toClipUpdateData(baseResult(), { outputUrl: 'renders/clip-1.mp4' });
    expect(data.viralityPrediction).toBe(noViralityPrediction);
    expect(data.viralityPrediction).not.toBe(Prisma.JsonNull);
  });
});
