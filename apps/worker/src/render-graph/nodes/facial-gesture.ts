import type {
  FacialEmotionFeatures,
  FacialEmotionSample,
  GestureFeatures,
  GestureSample,
} from '@speedora/contracts';
import { deriveFacialEmotionFeatures, detectFacialEmotion } from '@speedora/facial-intelligence';
import { deriveGestureFeatures, detectGestures } from '@speedora/gesture-intelligence';
import { facialIntelligenceDeps } from '../../facialIntelligenceDeps';
import { gestureIntelligenceDeps } from '../../gestureIntelligenceDeps';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Facial Intelligence (Fase 27, Phase C of the AI Fusion roadmap) - never fails the job, same
// "optional signal" pattern as every other detector. Null (not []) means total analysis failure,
// distinct from "ran successfully and found nothing" - same convention as the pre-graph code.
export const facialEmotionsNode: GraphNode<RenderGraphContext, FacialEmotionSample[] | null> = {
  id: 'facialEmotions',
  deps: [],
  optional: true,
  fallback: null,
  label: 'facial emotion detection',
  dataLabel: 'facial emotion data',
  run: (_get, ctx) =>
    detectFacialEmotion(
      { sourcePath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      facialIntelligenceDeps,
    ),
};

// Gesture Intelligence (Fase 30, Phase D / Checkpoint 2 of the AI Fusion roadmap) - same
// "never fails the job" pattern as facial emotion above.
export const gesturesNode: GraphNode<RenderGraphContext, GestureSample[] | null> = {
  id: 'gestures',
  deps: [],
  optional: true,
  fallback: null,
  label: 'gesture detection',
  dataLabel: 'gesture data',
  run: (_get, ctx) =>
    detectGestures(
      { sourcePath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      gestureIntelligenceDeps,
    ),
};

export const facialFeaturesNode: GraphNode<RenderGraphContext, FacialEmotionFeatures | null> = {
  id: 'facialFeatures',
  deps: ['facialEmotions'],
  optional: false,
  run: (get) => {
    const facialEmotions = get<FacialEmotionSample[] | null>('facialEmotions');
    return facialEmotions ? deriveFacialEmotionFeatures(facialEmotions) : null;
  },
};

export const gestureFeaturesNode: GraphNode<RenderGraphContext, GestureFeatures | null> = {
  id: 'gestureFeatures',
  deps: ['gestures'],
  optional: false,
  run: (get) => {
    const gestures = get<GestureSample[] | null>('gestures');
    return gestures ? deriveGestureFeatures(gestures) : null;
  },
};

export const facialGestureNodes = [
  facialEmotionsNode,
  gesturesNode,
  facialFeaturesNode,
  gestureFeaturesNode,
];
