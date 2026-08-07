import type {
  NarrativeGraph,
  NarrativeGraphDetectionSegment,
  SemanticEvent,
} from '@speedora/contracts';
import { buildNarrativeGraph } from '@speedora/narrative-graph';
import { openai } from '../../openai';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Re-anchors transcript segments onto the clip's own timeline (0 = this
// clip's start) - same convention as render-clip.worker.ts's
// toClipRelativeWords/nodes/hook-prediction.ts's toHookPredictionSegments/
// nodes/semantic-events.ts's toSemanticEventSegments.
function toNarrativeGraphSegments(
  transcript: RenderGraphContext['transcript'],
  startTime: number,
): NarrativeGraphDetectionSegment[] {
  return transcript.map((segment) => ({
    start: segment.start - startTime,
    end: segment.end - startTime,
    text: segment.text,
  }));
}

// AI Intelligence v4, Phase 3 (Narrative Graph - see docs/ai/
// intelligence-v4.md). optional: true / fallback: null - the LLM call can
// fail, never fails the render job, same convention as every prior v4
// node. Depends on semanticEvents (already-existing node id) purely as
// optional context for grounding segmentation - its absence (null,
// whether from Phase 2's own flag being off or its LLM call failing) does
// not block this phase from running; @speedora/narrative-graph builds the
// graph from transcript alone in that case. Runs on every render
// regardless of isNarrativeGraphEnabled() (ADR D8 - the flag gates
// GET /clips/:id/intelligence's exposure, not computation).
export const narrativeGraphNode: GraphNode<RenderGraphContext, NarrativeGraph | null> = {
  id: 'narrativeGraph',
  deps: ['semanticEvents'],
  optional: true,
  fallback: null,
  label: 'narrative graph',
  dataLabel: 'narrative graph data',
  run: (get, ctx) => {
    const semanticEvents = get<SemanticEvent[] | null>('semanticEvents');

    return buildNarrativeGraph(
      {
        segments: toNarrativeGraphSegments(ctx.transcript, ctx.startTime),
        semanticEvents,
        clipDurationSeconds: ctx.endTime - ctx.startTime,
      },
      { openai },
    );
  },
};

export const narrativeGraphNodes = [narrativeGraphNode];
