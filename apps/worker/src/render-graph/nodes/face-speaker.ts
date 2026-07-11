import type {
  ActiveSpeakerSample,
  FaceLandmarkFeatures,
  FaceTrackingQualityMetrics,
  LipSyncVerification,
  SpeakerFaceAssociation,
  SpeakerTimelineEntry,
  SpeakerTimelineFeatures,
  SpeakerFusionFeatures,
} from '@speedora/contracts';
import {
  associateSpeakersWithFaces,
  detectActiveSpeaker,
  verifyLipSync,
} from '@speedora/active-speaker-intelligence';
import {
  deriveFaceLandmarkFeatures,
  deriveTrackingQualityMetrics,
  detectFaceLandmarks,
  type FaceLandmarkSample,
} from '@speedora/facial-intelligence';
import type { GestureFeatures } from '@speedora/contracts';
import { buildSpeakerTimeline, detectSpeakerTransitions } from '@speedora/speaker-diarization';
import {
  deriveClipSpeakerScores,
  deriveSpeakerFusionFeatures,
  type ClipSpeakerScores,
} from '@speedora/speaker-scoring';
import { faceLandmarksDeps } from '../../faceLandmarksDeps';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Face Intelligence initiative Batch 1 (AI Fusion roadmap) - same "never fails the job" pattern
// as every other detector. Distinct subprocess/model from facial emotion (MediaPipe
// FaceLandmarker vs. a ViT expression classifier) - see detect_face_landmarks.py's module comment.
export const faceLandmarksNode: GraphNode<RenderGraphContext, FaceLandmarkSample[] | null> = {
  id: 'faceLandmarks',
  deps: [],
  optional: true,
  fallback: null,
  label: 'face landmark detection',
  dataLabel: 'face landmark data',
  run: (_get, ctx) =>
    detectFaceLandmarks(
      { sourcePath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      faceLandmarksDeps,
    ),
};

export const faceLandmarkFeaturesNode: GraphNode<RenderGraphContext, FaceLandmarkFeatures | null> =
  {
    id: 'faceLandmarkFeatures',
    deps: ['faceLandmarks'],
    optional: false,
    run: (get, ctx) => {
      const faceLandmarks = get<FaceLandmarkSample[] | null>('faceLandmarks');
      return faceLandmarks
        ? deriveFaceLandmarkFeatures(faceLandmarks, ctx.audioActivityWindows)
        : null;
    },
  };

// Batch 4.5 (Quality Metrics & Telemetry) - explainability/audit telemetry over faceLandmarks'
// own tracking, NOT fed into computeHighlightScore (explicitly not a scoring signal).
export const trackingQualityMetricsNode: GraphNode<
  RenderGraphContext,
  FaceTrackingQualityMetrics | null
> = {
  id: 'trackingQualityMetrics',
  deps: ['faceLandmarks'],
  optional: false,
  run: (get) => {
    const faceLandmarks = get<FaceLandmarkSample[] | null>('faceLandmarks');
    return faceLandmarks ? deriveTrackingQualityMetrics(faceLandmarks) : null;
  },
};

// Speaker Intelligence roadmap, Milestone A - pure aggregations over faceLandmarks + this clip's
// own transcript audio timing (no new subprocess) - null exactly when faceLandmarks is null.
export const activeSpeakerSamplesNode: GraphNode<RenderGraphContext, ActiveSpeakerSample[] | null> =
  {
    id: 'activeSpeakerSamples',
    deps: ['faceLandmarks'],
    optional: false,
    run: (get, ctx) => {
      const faceLandmarks = get<FaceLandmarkSample[] | null>('faceLandmarks');
      return faceLandmarks ? detectActiveSpeaker(faceLandmarks, ctx.audioActivityWindows) : null;
    },
  };

export const speakerFaceAssociationsNode: GraphNode<
  RenderGraphContext,
  SpeakerFaceAssociation[] | null
> = {
  id: 'speakerFaceAssociations',
  deps: ['activeSpeakerSamples'],
  optional: false,
  run: (get, ctx) => {
    const activeSpeakerSamples = get<ActiveSpeakerSample[] | null>('activeSpeakerSamples');
    return activeSpeakerSamples
      ? associateSpeakersWithFaces(ctx.speakerTurns, activeSpeakerSamples)
      : null;
  },
};

export const lipSyncVerificationsNode: GraphNode<RenderGraphContext, LipSyncVerification[] | null> =
  {
    id: 'lipSyncVerifications',
    deps: ['faceLandmarks'],
    optional: false,
    run: (get, ctx) => {
      const faceLandmarks = get<FaceLandmarkSample[] | null>('faceLandmarks');
      return faceLandmarks ? verifyLipSync(faceLandmarks, ctx.audioActivityWindows) : null;
    },
  };

// Speaker Intelligence roadmap, Milestone B - fuses this clip's own speaker turns with Milestone
// A's signals into one unified timeline. Does NOT depend on faceLandmarks having succeeded - it
// degrades to faceTrackId/isActiveOnScreen all-null entries rather than being null itself. Null
// only when there are no speaker turns covering this clip's time range at all.
export const speakerTimelineNode: GraphNode<RenderGraphContext, SpeakerTimelineEntry[] | null> = {
  id: 'speakerTimeline',
  deps: ['speakerFaceAssociations', 'activeSpeakerSamples'],
  optional: false,
  run: (get, ctx) => {
    if (ctx.speakerTurns.length === 0) return null;
    return buildSpeakerTimeline(
      ctx.speakerTurns,
      get<SpeakerFaceAssociation[] | null>('speakerFaceAssociations') ?? [],
      get<ActiveSpeakerSample[] | null>('activeSpeakerSamples') ?? [],
    );
  },
};

export const speakerTimelineFeaturesNode: GraphNode<
  RenderGraphContext,
  SpeakerTimelineFeatures | null
> = {
  id: 'speakerTimelineFeatures',
  deps: [],
  optional: false,
  run: (_get, ctx) =>
    ctx.speakerTurns.length > 0 ? detectSpeakerTransitions(ctx.speakerTurns) : null,
};

// Speaker Intelligence roadmap, Milestone C - Speaker Confidence/Engagement/Importance and
// per-turn Highlight Moments. Reuses the same transcript/faceLandmarks already in scope - no new
// detection. hookStrength comes from this clip's own LLM scores (clip-level, not moment-level).
// Null when speakerTimeline itself is null (nothing to score).
export const speakerScoresNode: GraphNode<RenderGraphContext, ClipSpeakerScores | null> = {
  id: 'speakerScores',
  deps: ['speakerTimeline', 'faceLandmarks', 'gestureFeatures'],
  optional: false,
  run: (get, ctx) => {
    const speakerTimeline = get<SpeakerTimelineEntry[] | null>('speakerTimeline');
    if (!speakerTimeline) return null;
    return deriveClipSpeakerScores({
      speakerTimeline,
      faceLandmarks: get<FaceLandmarkSample[] | null>('faceLandmarks') ?? [],
      audioActivity: ctx.audioActivityWindows,
      transcriptSegments: ctx.transcript.map((segment) => ({
        speaker: segment.speaker,
        rmsDb: segment.rmsDb ?? null,
        peakDb: segment.peakDb ?? null,
        speakingRateWordsPerSecond: segment.speakingRateWordsPerSecond ?? null,
      })),
      gestureFeatures: get<GestureFeatures | null>('gestureFeatures'),
      clipDurationSeconds: ctx.endTime - ctx.startTime,
      hookStrength: ctx.scores?.hookStrength ?? null,
    });
  },
};

// Speaker Intelligence roadmap, Milestone D - collapses Milestone C's per-speaker/per-moment
// output into the single clip-level feature set the Fusion Engine consumes.
export const speakerFusionFeaturesNode: GraphNode<
  RenderGraphContext,
  SpeakerFusionFeatures | null
> = {
  id: 'speakerFusionFeatures',
  deps: ['speakerScores'],
  optional: false,
  run: (get) => {
    const speakerScores = get<ClipSpeakerScores | null>('speakerScores');
    return speakerScores ? deriveSpeakerFusionFeatures(speakerScores) : null;
  },
};

export const faceSpeakerNodes = [
  faceLandmarksNode,
  faceLandmarkFeaturesNode,
  trackingQualityMetricsNode,
  activeSpeakerSamplesNode,
  speakerFaceAssociationsNode,
  lipSyncVerificationsNode,
  speakerTimelineNode,
  speakerTimelineFeaturesNode,
  speakerScoresNode,
  speakerFusionFeaturesNode,
];
