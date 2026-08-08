import type {
  EditingSuggestionTimeline,
  OcrTextTrack,
  PrimarySubjectSample,
  RetentionCurveInsights,
  SubtitleIntelligence,
  TranscriptWordInput,
} from '@speedora/contracts';
import { computeEditingSuggestions } from '@speedora/visual-emphasis';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Re-anchors this clip's own transcript words onto the clip's own timeline
// (0 = this clip's start), flattened across every segment - same
// convention as nodes/hook-prediction.ts's toHookPredictionSegments /
// nodes/subtitle-rewriter.ts's toSubtitleRewriterSegments, but flattened
// straight to TranscriptWordInput[] since fromPauses() (via
// @speedora/cutlist's computeSilenceCuts()) only needs the flat word list,
// not segment structure.
function toClipRelativeWords(
  transcript: RenderGraphContext['transcript'],
  startTime: number,
): TranscriptWordInput[] {
  return transcript.flatMap(
    (segment) =>
      segment.words?.map((word) => ({
        word: word.word,
        start: word.start - startTime,
        end: word.end - startTime,
      })) ?? [],
  );
}

// AI Intelligence v4 Track B, Phase C1 (Visual Emphasis Engine, spec Part
// 9 - see docs/ai/visual-emphasis-engine.md). Same optional: false shape as
// every other pure-derive composition node (Phase 4/5/6/7/10, Subtitle/
// Dynamic Caption) - a post-hoc composition over 5 already-resolved
// upstream node outputs, no LLM/subprocess call that can fail. Runs on
// every render regardless of isVisualEmphasisEnabled() (ADR D8 - the flag
// gates GET /clips/:id/intelligence's exposure, not computation). Phase C1
// ships the data only (five heuristic technique detectors + one
// chronologically-sorted timeline) - wiring any suggestion into an actual
// crop-path/render decision is a later phase's job (C2-C7).
export const editingSuggestionsNode: GraphNode<RenderGraphContext, EditingSuggestionTimeline> = {
  id: 'editingSuggestions',
  deps: ['subtitleIntelligence', 'ocrTracks', 'primarySubjectSamples', 'retentionCurveInsights'],
  optional: false,
  run: (get, ctx) => {
    const subtitleIntelligence = get<SubtitleIntelligence>('subtitleIntelligence');
    const ocrTracks = get<OcrTextTrack[] | null>('ocrTracks');
    const primarySubjectSamples = get<PrimarySubjectSample[]>('primarySubjectSamples');
    const retentionCurveInsights = get<RetentionCurveInsights>('retentionCurveInsights');

    return computeEditingSuggestions({
      highlights: subtitleIntelligence.highlights,
      ocrTracks,
      primarySubjectSamples,
      retentionCurveInsights,
      words: toClipRelativeWords(ctx.transcript, ctx.startTime),
      clipDurationSeconds: ctx.endTime - ctx.startTime,
    });
  },
};

export const visualEmphasisNodes = [editingSuggestionsNode];
