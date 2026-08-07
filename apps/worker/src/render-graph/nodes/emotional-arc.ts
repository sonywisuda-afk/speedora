import type { EmotionalArc, EmotionalArcSegment, SemanticEvent } from '@speedora/contracts';
import { computeEmotionalArc } from '@speedora/emotional-arc';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Re-anchors transcript segments onto the clip's own timeline (0 = this
// clip's start) - same convention as nodes/hook-prediction.ts's
// toHookPredictionSegments/nodes/narrative-graph.ts's toNarrativeGraphSegments.
function toEmotionalArcSegments(
  transcript: RenderGraphContext['transcript'],
  startTime: number,
): EmotionalArcSegment[] {
  return transcript.map((segment) => ({
    start: segment.start - startTime,
    end: segment.end - startTime,
    emotion: segment.emotion ?? null,
  }));
}

// AI Intelligence v4, Phase 5 (Emotional Arc - see docs/ai/
// intelligence-v4.md). Same optional: false shape as Phase 4's
// contextualMomentumNode - a pure, synchronous composition over
// already-resolved upstream data (ctx.transcript's own already-persisted
// emotion labels + the semanticEvents node's output, an already-existing
// node id read purely as optional context, same degrade-gracefully pattern
// narrativeGraphNode already uses for it), no LLM/subprocess call that can
// fail. Runs on every render regardless of isEmotionalArcEnabled() (ADR
// D8 - the flag gates GET /clips/:id/intelligence's exposure, not
// computation).
export const emotionalArcNode: GraphNode<RenderGraphContext, EmotionalArc> = {
  id: 'emotionalArc',
  deps: ['semanticEvents'],
  optional: false,
  run: (get, ctx) => {
    const semanticEvents = get<SemanticEvent[] | null>('semanticEvents');

    return computeEmotionalArc({
      clipDurationSeconds: ctx.endTime - ctx.startTime,
      segments: toEmotionalArcSegments(ctx.transcript, ctx.startTime),
      semanticEvents,
    });
  },
};

export const emotionalArcNodes = [emotionalArcNode];
