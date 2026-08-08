import type {
  AudioFeatures,
  EmotionalArc,
  MomentumCurve,
  SemanticEvent,
  SubtitleIntelligence,
  SubtitleSegment,
} from '@speedora/contracts';
import { computeSubtitleTimeline } from '@speedora/subtitle-rewriter';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Re-anchors transcript segments onto the clip's own timeline (0 = this
// clip's start) - same convention as nodes/emotional-arc.ts's
// toEmotionalArcSegments/nodes/hook-prediction.ts's toHookPredictionSegments.
// Word-level timestamps are re-anchored too, byte-for-byte the same values
// otherwise (ADR DB1 - this node only ever shifts time, never the words
// themselves).
function toSubtitleRewriterSegments(
  transcript: RenderGraphContext['transcript'],
  startTime: number,
): SubtitleSegment[] {
  return transcript.map((segment) => ({
    start: segment.start - startTime,
    end: segment.end - startTime,
    text: segment.text,
    speaker: segment.speaker,
    words: segment.words?.map((word) => ({
      word: word.word,
      start: word.start - startTime,
      end: word.end - startTime,
    })),
  }));
}

// AI Intelligence v4 Track B, Phase A1 (Subtitle Rewriter, spec Part 7 -
// see docs/ai/subtitle-intelligence.md). Same optional: false shape as
// Phase 4/5/6/7/10's own pure-derive nodes - a post-hoc composition over
// already-resolved upstream data (contextualMomentum/emotionalArc/
// semanticEvents/audioFeatures nodes' own outputs, all already-existing
// node ids), no LLM/subprocess call that can fail. Runs on every render
// regardless of isSubtitleRewriteEnabled() (ADR D8 - the flag gates
// GET /clips/:id/intelligence's exposure, not computation). Does NOT touch
// buildAss()/the actual burned-in output - that's Phase A2's job (ADR DB4,
// data first).
export const subtitleIntelligenceNode: GraphNode<RenderGraphContext, SubtitleIntelligence> = {
  id: 'subtitleIntelligence',
  deps: ['contextualMomentum', 'emotionalArc', 'semanticEvents', 'audioFeatures'],
  optional: false,
  run: (get, ctx) => {
    const momentumCurve = get<MomentumCurve>('contextualMomentum');
    const emotionalArc = get<EmotionalArc>('emotionalArc');
    const semanticEvents = get<SemanticEvent[] | null>('semanticEvents');
    const audioFeatures = get<AudioFeatures>('audioFeatures');

    return computeSubtitleTimeline({
      clipId: ctx.clipId,
      segments: toSubtitleRewriterSegments(ctx.transcript, ctx.startTime),
      momentumCurve,
      emotionalArc,
      semanticEvents,
      averageSpeakingRateWordsPerSecond: audioFeatures.averageSpeakingRateWordsPerSecond,
    });
  },
};

export const subtitleRewriterNodes = [subtitleIntelligenceNode];
