import type {
  ObjectTrack,
  OcrTextTrack,
  SemanticEvent,
  SemanticEventDetectionSegment,
} from '@speedora/contracts';
import { detectSemanticEvents } from '@speedora/semantic-events';
import { openai } from '../../openai';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Re-anchors transcript segments onto the clip's own timeline (0 = this
// clip's start) - same convention as render-clip.worker.ts's
// toClipRelativeWords/nodes/hook-prediction.ts's toHookPredictionSegments.
function toSemanticEventSegments(
  transcript: RenderGraphContext['transcript'],
  startTime: number,
): SemanticEventDetectionSegment[] {
  return transcript.map((segment) => ({
    start: segment.start - startTime,
    end: segment.end - startTime,
    text: segment.text,
  }));
}

// AI Intelligence v4, Phase 2 (Semantic Event Detection - see docs/ai/
// intelligence-v4.md). optional: true / fallback: null - the LLM call can
// fail, never fails the render job, same convention as
// nodes/hook-prediction.ts's hookPredictionNode. Depends on ocrTracks/
// objectTracks (already-existing node ids) purely for grounding evidence -
// their absence (both null, degrading to []) still lets event detection
// itself succeed with empty evidence, it just means nothing to cite. Runs
// on every render regardless of isSemanticEventDetectionEnabled() (ADR D8
// - the flag gates GET /clips/:id/intelligence's exposure, not
// computation).
export const semanticEventsNode: GraphNode<RenderGraphContext, SemanticEvent[] | null> = {
  id: 'semanticEvents',
  deps: ['ocrTracks', 'objectTracks'],
  optional: true,
  fallback: null,
  label: 'semantic event detection',
  dataLabel: 'semantic event data',
  run: (get, ctx) => {
    const ocrTracks = get<OcrTextTrack[] | null>('ocrTracks') ?? [];
    const objectTracks = get<ObjectTrack[] | null>('objectTracks') ?? [];

    return detectSemanticEvents(
      {
        segments: toSemanticEventSegments(ctx.transcript, ctx.startTime),
        ocrTracks,
        objectTracks,
      },
      { openai },
    );
  },
};

export const semanticEventNodes = [semanticEventsNode];
