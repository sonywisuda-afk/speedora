import type {
  EmotionalArc,
  MomentumCurve,
  MultiSpeakerBreakdown,
  SpeakerTimelineEntry,
} from '@speedora/contracts';
import { computeMultiSpeakerBreakdown } from '@speedora/multi-speaker-reasoning';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// AI Intelligence v4, Phase 6 (Multi-speaker Reasoning - see docs/ai/
// intelligence-v4.md). Same optional: false shape as Phase 4/5's own
// pure-derive nodes - a post-hoc composition over already-resolved
// upstream data (speakerTimeline, an already-existing Speaker Intelligence
// node id, + contextualMomentum/emotionalArc from Phases 4/5), no LLM/
// subprocess call that can fail. Runs on every render regardless of
// isMultiSpeakerReasoningEnabled() (ADR D8 - the flag gates
// GET /clips/:id/intelligence's exposure, not computation).
export const multiSpeakerReasoningNode: GraphNode<
  RenderGraphContext,
  MultiSpeakerBreakdown | null
> = {
  id: 'multiSpeakerBreakdown',
  deps: ['speakerTimeline', 'contextualMomentum', 'emotionalArc'],
  optional: false,
  run: (get) => {
    const speakerTimeline = get<SpeakerTimelineEntry[] | null>('speakerTimeline');
    const momentumCurve = get<MomentumCurve>('contextualMomentum');
    const emotionalArc = get<EmotionalArc>('emotionalArc');

    return computeMultiSpeakerBreakdown({ speakerTimeline, momentumCurve, emotionalArc });
  },
};

export const multiSpeakerReasoningNodes = [multiSpeakerReasoningNode];
