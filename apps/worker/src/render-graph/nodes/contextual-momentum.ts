import type {
  CameraMotionSample,
  EditingRhythmFeatures,
  MomentumCurve,
  MotionEnergySample,
  NarrativeGraph,
} from '@speedora/contracts';
import { computeMomentumCurve } from '@speedora/contextual-momentum';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// AI Intelligence v4, Phase 4 (Contextual Momentum - see docs/ai/
// intelligence-v4.md). Unlike every prior v4 node, this one is
// optional: false - a pure, synchronous composition over already-resolved
// upstream data (motionEnergy/cameraMotion/editingRhythmFeatures/
// narrativeGraph, all already-existing node ids), no LLM/subprocess call
// that can fail - same convention as editingRhythmFeaturesNode/
// compositionFeaturesNode for pure-derive nodes. Runs on every render
// regardless of isContextualMomentumEnabled() (ADR D8 - the flag gates
// GET /clips/:id/intelligence's exposure, not computation).
export const contextualMomentumNode: GraphNode<RenderGraphContext, MomentumCurve> = {
  id: 'contextualMomentum',
  deps: ['motionEnergy', 'cameraMotion', 'editingRhythmFeatures', 'narrativeGraph'],
  optional: false,
  run: (get, ctx) => {
    const motionEnergySamples = get<MotionEnergySample[]>('motionEnergy');
    const cameraMotionSamples = get<CameraMotionSample[] | null>('cameraMotion');
    const editingRhythmFeatures = get<EditingRhythmFeatures>('editingRhythmFeatures');
    const narrativeGraph = get<NarrativeGraph | null>('narrativeGraph');

    return computeMomentumCurve({
      clipDurationSeconds: ctx.endTime - ctx.startTime,
      motionEnergySamples,
      cameraMotionSamples,
      accelerationScore: editingRhythmFeatures.accelerationScore,
      narrativeGraph,
    });
  },
};

export const contextualMomentumNodes = [contextualMomentumNode];
