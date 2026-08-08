import type {
  EmotionalArc,
  HookPredictionOutput,
  MomentumCurve,
  NarrativeGraph,
  ViralityPrediction,
} from '@speedora/contracts';
import { computeViralityPrediction } from '@speedora/virality-engine';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// AI Intelligence v4, Phase 7 (Cross-module Fusion, spec Part 4 - Virality
// Engine - see docs/ai/intelligence-v4.md). Same optional: false shape as
// Phase 4/5/6's own pure-derive nodes - a post-hoc composition over
// already-resolved upstream data (the hookPrediction/narrativeGraph/
// contextualMomentum/emotionalArc nodes' own outputs - all already-
// existing node ids, exactly the roadmap's own stated dependency list:
// Phases 1, 3, 4, 5), no LLM/subprocess call that can fail. Runs on every
// render regardless of isViralityEngineEnabled() (ADR D8 - the flag gates
// GET /clips/:id/intelligence's exposure, not computation).
export const viralityPredictionNode: GraphNode<RenderGraphContext, ViralityPrediction> = {
  id: 'viralityPrediction',
  deps: ['hookPrediction', 'narrativeGraph', 'contextualMomentum', 'emotionalArc'],
  optional: false,
  run: (get, ctx) => {
    const hookPrediction = get<HookPredictionOutput | null>('hookPrediction');
    const narrativeGraph = get<NarrativeGraph | null>('narrativeGraph');
    const momentumCurve = get<MomentumCurve>('contextualMomentum');
    const emotionalArc = get<EmotionalArc>('emotionalArc');

    return computeViralityPrediction({
      clipId: ctx.clipId,
      hookPrediction,
      narrativeGraph,
      momentumCurve,
      emotionalArc,
    });
  },
};

export const viralityEngineNodes = [viralityPredictionNode];
