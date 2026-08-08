import type {
  EmotionalArc,
  MomentumCurve,
  RetentionCurveInsights,
  SemanticEvent,
} from '@speedora/contracts';
import { computeRetentionCurveInsights } from '@speedora/retention-curve-insights';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// AI Intelligence v4, Phase 10 (Retention Curve Insights, spec Part 5
// extension - see docs/ai/intelligence-v4.md). Same optional: false shape
// as Phase 4/5/6/9's own pure-derive nodes - a post-hoc composition over
// already-resolved upstream data (the contextualMomentum/emotionalArc/
// semanticEvents nodes' own outputs - all already-existing node ids, no
// new upstream detector), no LLM/subprocess call that can fail. Runs on
// every render regardless of isRetentionCurveInsightsEnabled() (ADR D8 -
// the flag gates GET /clips/:id/intelligence's exposure, not
// computation).
export const retentionCurveInsightsNode: GraphNode<RenderGraphContext, RetentionCurveInsights> = {
  id: 'retentionCurveInsights',
  deps: ['contextualMomentum', 'emotionalArc', 'semanticEvents'],
  optional: false,
  run: (get, ctx) => {
    const momentumCurve = get<MomentumCurve>('contextualMomentum');
    const emotionalArc = get<EmotionalArc>('emotionalArc');
    const semanticEvents = get<SemanticEvent[] | null>('semanticEvents');

    return computeRetentionCurveInsights({
      clipId: ctx.clipId,
      momentumCurve,
      emotionalArc,
      semanticEvents,
    });
  },
};

export const retentionCurveInsightsNodes = [retentionCurveInsightsNode];
