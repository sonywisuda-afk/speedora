import type {
  ComputeSubtitleTimelineInput,
  SubtitleIntelligence,
  SubtitleLine,
} from '@speedora/contracts';
import { chunkSegmentIntoLines } from './chunk-segment';
import { computeHighlightTimeline } from './compute-highlights';

// The module's single entry point (ARCHITECTURE.md's JSON-contract module
// checklist) - pure and synchronous, no `deps` parameter, same zero-LLM
// shape as Phase 4/5/6/7/10 (DB1/DB2, docs/ai/subtitle-intelligence.md).
// STRUCTURAL re-chunking only: every word/order/timestamp from `segments`
// passes through completely unmodified - this function only decides how
// words already spoken group into caption LINES and which of those already-
// spoken words get flagged for bold/uppercase-style emphasis. A future
// lexical-paraphrase capability is explicitly out of scope here (see
// docs/ai/subtitle-intelligence.md's "Explicitly deferred" section).
//
// Deliberately does NOT runtime-validate `input` against
// computeSubtitleTimelineInputSchema (unlike @speedora/subtitles'
// buildAss(), which validates as defense-in-depth) - same convention every
// other no-LLM v4 pure-derive module (Phase 4/5/6/7/10) already
// establishes: the input comes only from an internal render-graph caller,
// never untrusted external JSON, and every optional field is read with a
// falsy/nullish check below rather than a strict `=== null` comparison, so
// an upstream node id that resolves to `undefined` (e.g. a node whose
// `run()` legitimately settles without a value) degrades the same way
// `null` does instead of throwing a ZodError.
//
// A segment with no word-level timestamps (older transcript, or a segment
// Whisper returned with none) is passed through as a single, unrewritten
// line spanning the whole segment - the same fallback @speedora/subtitles'
// buildDialogueEvent() already uses for karaoke/BOLD_HIGHLIGHT (Tech Debt
// #8, docs/ai/subtitle-intelligence.md).
export function computeSubtitleTimeline(input: ComputeSubtitleTimelineInput): SubtitleIntelligence {
  const {
    clipId,
    segments,
    momentumCurve,
    emotionalArc,
    semanticEvents,
    averageSpeakingRateWordsPerSecond,
  } = input;

  const timeline: SubtitleLine[] = segments.flatMap((segment) => {
    if (!segment.words || segment.words.length === 0) {
      return [
        {
          start: segment.start,
          end: segment.end,
          text: segment.text,
          words: [],
          speaker: segment.speaker,
          emphasisWordIndices: [],
        },
      ];
    }
    return chunkSegmentIntoLines(
      segment,
      segment.words,
      averageSpeakingRateWordsPerSecond,
      momentumCurve,
    );
  });

  return {
    clipId,
    timeline,
    highlights: computeHighlightTimeline(timeline, emotionalArc, momentumCurve, semanticEvents),
  };
}
