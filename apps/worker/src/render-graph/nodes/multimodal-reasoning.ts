import type {
  FacialEmotionSample,
  GestureSample,
  MultimodalReasoningResult,
  ObjectTrack,
  OcrTextTrack,
  SceneCutEvent,
  SpeakerTimelineEntry,
} from '@speedora/contracts';
import {
  reasonMultimodal,
  type NormalizeEvidenceTranscriptSegment,
} from '@speedora/multimodal-reasoning';
import { openai } from '../../openai';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Re-anchors transcript segments onto the clip's own timeline (0 = this clip's start) - same
// convention as render-clip.worker.ts's toClipRelativeWords/nodes/hook-prediction.ts's
// toHookPredictionSegments/nodes/semantic-events.ts's toSemanticEventSegments/
// nodes/narrative-graph.ts's toNarrativeGraphSegments. Every other node id this node depends on
// (sceneCutEvents/ocrTracks/objectTracks/facialEmotions/gestures/speakerTimeline) is already
// clip-relative by the time it's a graph node output - only ctx.transcript itself needs this.
function toMultimodalTranscriptSegments(
  transcript: RenderGraphContext['transcript'],
  startTime: number,
): NormalizeEvidenceTranscriptSegment[] {
  return transcript.map((segment) => ({
    start: segment.start - startTime,
    end: segment.end - startTime,
    text: segment.text,
    speaker: segment.speaker,
    rmsDb: segment.rmsDb ?? null,
    peakDb: segment.peakDb ?? null,
    speakingRateWordsPerSecond: segment.speakingRateWordsPerSecond ?? null,
  }));
}

// AI Intelligence v4, Phase 11 (Multimodal Reasoning Engine, spec Part 6 - see docs/ai/
// intelligence-v4.md). optional: true / fallback: null - the LLM call can fail, never fails the
// render job, same convention as every prior LLM-backed v4 node (hookPrediction/semanticEvents/
// narrativeGraph). Depends on every raw evidence source this phase reasons over
// (sceneCutEvents/ocrTracks/objectTracks/facialEmotions/gestures/speakerTimeline - all
// already-existing node ids); each one's absence (null - the upstream detector itself failed or
// never ran) degrades to an empty array rather than blocking this node, same "missing modality is a
// real, handled case, not a failure" posture Part 6 itself asks for. activeSpeakerSamples is
// deliberately NOT a dep - speakerTimeline already fuses it (see
// @speedora/multimodal-reasoning's normalizeEvidence module comment). Runs on every render
// regardless of isMultimodalReasoningEnabled() (ADR D8 - the flag gates
// GET /clips/:id/intelligence's exposure, not computation).
export const multimodalReasoningNode: GraphNode<
  RenderGraphContext,
  MultimodalReasoningResult | null
> = {
  id: 'multimodalReasoning',
  deps: [
    'sceneCutEvents',
    'ocrTracks',
    'objectTracks',
    'facialEmotions',
    'gestures',
    'speakerTimeline',
  ],
  optional: true,
  fallback: null,
  label: 'multimodal reasoning',
  dataLabel: 'multimodal reasoning data',
  run: (get, ctx) =>
    reasonMultimodal(
      {
        clipId: ctx.clipId,
        transcript: toMultimodalTranscriptSegments(ctx.transcript, ctx.startTime),
        sceneCutEvents: get<SceneCutEvent[] | null>('sceneCutEvents') ?? [],
        ocrTracks: get<OcrTextTrack[] | null>('ocrTracks') ?? [],
        objectTracks: get<ObjectTrack[] | null>('objectTracks') ?? [],
        facialEmotions: get<FacialEmotionSample[] | null>('facialEmotions') ?? [],
        gestures: get<GestureSample[] | null>('gestures') ?? [],
        speakerTimeline: get<SpeakerTimelineEntry[] | null>('speakerTimeline') ?? [],
      },
      { openai },
    ),
};

export const multimodalReasoningNodes = [multimodalReasoningNode];
