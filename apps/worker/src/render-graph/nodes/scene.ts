import type {
  CameraMotionFeatures,
  CameraMotionSample,
  MotionEnergyFeatures,
  MotionEnergySample,
  SceneCutEvent,
  SceneFeatures,
} from '@speedora/contracts';
import {
  classifySceneCutTypes,
  deriveCameraMotionFeatures,
  deriveMotionEnergyFeatures,
  deriveSceneFeatures,
  detectCameraMotion,
  detectSceneCuts,
  analyzeMotionEnergy,
} from '@speedora/scene-intelligence';
import { cameraMotionDeps } from '../../cameraMotionDeps';
import { sceneIntelligenceDeps } from '../../sceneIntelligenceDeps';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Scene Intelligence (Fase 26) - same "never fails the job" pattern as every other detector,
// formalized as node.optional: true + fallback instead of a hand-written try/catch. The exact
// warn-message wording is produced by render-clip's own onNodeFailure override (see index.ts),
// not by this file - label/dataLabel here are just the two words that override plugs into its
// template, matching this signal's existing "scene cut detection"/"scene data" wording exactly.
export const sceneCutsNode: GraphNode<RenderGraphContext, number[]> = {
  id: 'sceneCuts',
  deps: [],
  optional: true,
  fallback: [],
  label: 'scene cut detection',
  dataLabel: 'scene data',
  run: async (_get, ctx) => {
    const result = await detectSceneCuts(
      { videoPath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      sceneIntelligenceDeps,
    );
    return result.cuts;
  },
};

// Batch SC-1 - classifies whichever cuts sceneCutsNode just found. Null (not []) when
// classification wasn't run or failed entirely, distinct from an empty array (no cuts to
// classify) - same convention as the pre-graph code.
export const sceneCutEventsNode: GraphNode<RenderGraphContext, SceneCutEvent[] | null> = {
  id: 'sceneCutEvents',
  deps: ['sceneCuts'],
  optional: true,
  fallback: null,
  label: 'scene cut type classification',
  dataLabel: 'cut-type data',
  run: async (get, ctx) => {
    const result = await classifySceneCutTypes(
      {
        videoPath: ctx.sourcePath,
        startTime: ctx.startTime,
        endTime: ctx.endTime,
        cuts: get<number[]>('sceneCuts'),
      },
      sceneIntelligenceDeps,
    );
    return result.events;
  },
};

// Batch SC-2 - a SEPARATE signal from sceneCuts/sceneCutEvents above (motion magnitude/
// Static-Dynamic classification, not cut events). analyzeMotionEnergy already catches its own
// ffmpeg failures internally (defense in depth, same as the pre-graph code's own double-wrapping).
export const motionEnergyNode: GraphNode<RenderGraphContext, MotionEnergySample[]> = {
  id: 'motionEnergy',
  deps: [],
  optional: true,
  fallback: [],
  label: 'motion energy analysis',
  dataLabel: 'motion data',
  run: async (_get, ctx) => {
    const result = await analyzeMotionEnergy(
      { videoPath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      sceneIntelligenceDeps,
    );
    return result.samples;
  },
};

// Batch SC-3 - DIRECTIONAL camera motion (pan/tilt/zoom/shake), a separate signal from
// motionEnergy above (undirected magnitude). A Python/OpenCV subprocess, unlike motionEnergy's
// ffmpeg-based analyzeMotionEnergy.
export const cameraMotionNode: GraphNode<RenderGraphContext, CameraMotionSample[] | null> = {
  id: 'cameraMotion',
  deps: [],
  optional: true,
  fallback: null,
  label: 'camera motion detection',
  dataLabel: 'camera motion data',
  run: (_get, ctx) =>
    detectCameraMotion(
      { sourcePath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      cameraMotionDeps,
    ),
};

// Mini Fusion Engine v1/v2 prep - always computed (sceneCuts/sceneCutEvents are always arrays by
// the time this runs, even if empty), same convention as the pre-graph code.
export const sceneFeaturesNode: GraphNode<RenderGraphContext, SceneFeatures> = {
  id: 'sceneFeatures',
  deps: ['sceneCuts', 'sceneCutEvents'],
  optional: false,
  run: (get, ctx) =>
    deriveSceneFeatures(
      get<number[]>('sceneCuts'),
      ctx.endTime - ctx.startTime,
      get<SceneCutEvent[] | null>('sceneCutEvents') ?? [],
    ),
};

// Batch SC-2 - always computed (motionEnergy is always an array, even if empty).
export const motionEnergyFeaturesNode: GraphNode<RenderGraphContext, MotionEnergyFeatures> = {
  id: 'motionEnergyFeatures',
  deps: ['motionEnergy'],
  optional: false,
  run: (get, ctx) =>
    deriveMotionEnergyFeatures(
      get<MotionEnergySample[]>('motionEnergy'),
      ctx.endTime - ctx.startTime,
    ),
};

// Batch SC-3 - null exactly when cameraMotion is null, same convention as the pre-graph code.
export const cameraMotionFeaturesNode: GraphNode<RenderGraphContext, CameraMotionFeatures | null> =
  {
    id: 'cameraMotionFeatures',
    deps: ['cameraMotion'],
    optional: false,
    run: (get) => {
      const cameraMotion = get<CameraMotionSample[] | null>('cameraMotion');
      return cameraMotion ? deriveCameraMotionFeatures(cameraMotion) : null;
    },
  };

export const sceneNodes = [
  sceneCutsNode,
  sceneCutEventsNode,
  motionEnergyNode,
  cameraMotionNode,
  sceneFeaturesNode,
  motionEnergyFeaturesNode,
  cameraMotionFeaturesNode,
];
